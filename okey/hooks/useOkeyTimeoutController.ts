import { useCallback, useEffect, useState, useRef } from "react";
import type { SupabaseOkeyMatchAdapter, OkeyTurnTimeoutClaim } from "../adapters/supabase-okey-match-adapter";
import type { OkeyMatchServerProjection } from "../server/okey-authoritative";

type Mutable<T> = { current: T };

export function useOkeyTimeoutController(input: {
  matchId?: string;
  turnTimeLeft: number;
  currentPlayerId: string;
  projection: OkeyMatchServerProjection | null;
  currentUserId: string | null;
  adapter: SupabaseOkeyMatchAdapter | null;
  refreshSnapshot: () => Promise<any>;
  matchIdRef: Mutable<string | undefined>;
  activeTurnKeyRef: Mutable<string | null>;
  serverClockOffsetMsRef: Mutable<number>;
  timeoutPassInFlightRef: Mutable<boolean>;
  timeoutRetryRef: Mutable<ReturnType<typeof setTimeout> | null>;
  timeoutSubmitRef: Mutable<(
    (claim: OkeyTurnTimeoutClaim, turnKey: string, matchId: string) => void
  ) | null>;
  clearTimeoutRetry: () => void;
}) {
  const syncServerClock = useCallback((serverNow: unknown) => {
    if (typeof serverNow !== "string") return false;
    const serverNowMs = Date.parse(serverNow);
    if (!Number.isFinite(serverNowMs)) return false;
    input.serverClockOffsetMsRef.current = serverNowMs - Date.now();
    return true;
  }, [input.serverClockOffsetMsRef]);

  const scheduleTimeoutRetry = useCallback((
    claim: OkeyTurnTimeoutClaim,
    turnKey: string,
    claimMatchId: string,
    expiresAt: unknown,
  ) => {
    input.clearTimeoutRetry();
    if (
      input.matchIdRef.current !== claimMatchId ||
      input.activeTurnKeyRef.current !== turnKey ||
      typeof expiresAt !== "string"
    ) return;
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      console.warn("okey_match timeout response has no valid expiresAt");
      return;
    }
    const synchronizedNow = Date.now() + input.serverClockOffsetMsRef.current;
    input.timeoutRetryRef.current = setTimeout(() => {
      input.timeoutRetryRef.current = null;
      if (
        input.matchIdRef.current === claimMatchId &&
        input.activeTurnKeyRef.current === turnKey
      ) input.timeoutSubmitRef.current?.(claim, turnKey, claimMatchId);
    }, Math.max(0, expiresAtMs - synchronizedNow));
  }, [
    input.activeTurnKeyRef,
    input.clearTimeoutRetry,
    input.matchIdRef,
    input.serverClockOffsetMsRef,
    input.timeoutRetryRef,
    input.timeoutSubmitRef,
  ]);

  const submitTimeoutClaim = useCallback(async (
    claim: OkeyTurnTimeoutClaim,
    turnKey: string,
    claimMatchId: string,
  ) => {
    if (
      !input.adapter ||
      !input.currentUserId ||
      input.currentUserId !== claim.expectedTurnPlayerId ||
      input.timeoutPassInFlightRef.current ||
      input.matchIdRef.current !== claimMatchId ||
      input.activeTurnKeyRef.current !== turnKey
    ) return;
    input.timeoutPassInFlightRef.current = true;
    try {
      const result = await input.adapter.resolveTimeout(claim);
      syncServerClock(result?.serverNow);
      if (
        input.matchIdRef.current !== claimMatchId ||
        input.activeTurnKeyRef.current !== turnKey
      ) return;
      input.clearTimeoutRetry();
      await input.refreshSnapshot();
    } catch (caught: any) {
      const response = caught?.details || caught;
      syncServerClock(response?.serverNow);
      if (response?.code === "turn_timer_not_expired") {
        await input.refreshSnapshot().catch(() => undefined);
        scheduleTimeoutRetry(claim, turnKey, claimMatchId, response?.expiresAt);
        return;
      }
      if (response?.code === "stale_timeout" || response?.code === "already_processed" || response?.error === "already_processed") {
        input.clearTimeoutRetry();
      }
      if (input.matchIdRef.current === claimMatchId) {
        await input.refreshSnapshot().catch(() => undefined);
      }
    } finally {
      input.timeoutPassInFlightRef.current = false;
    }
  }, [
    input.activeTurnKeyRef,
    input.adapter,
    input.clearTimeoutRetry,
    input.currentUserId,
    input.refreshSnapshot,
    input.matchIdRef,
    input.timeoutPassInFlightRef,
    scheduleTimeoutRetry,
    syncServerClock,
  ]);

  useEffect(() => {
    input.timeoutSubmitRef.current = (claim, turnKey, matchId) => {
      void submitTimeoutClaim(claim, turnKey, matchId);
    };
    return () => {
      input.timeoutSubmitRef.current = null;
    };
  }, [input.timeoutSubmitRef, submitTimeoutClaim]);

  useEffect(() => {
    if (
      !input.matchId ||
      !input.currentUserId ||
      input.currentUserId !== input.currentPlayerId ||
      input.turnTimeLeft > 0 ||
      input.projection?.matchFinished ||
      input.timeoutPassInFlightRef.current ||
      input.timeoutRetryRef.current
    ) return;

    const expectedVersion = Number(input.projection?.version);
    const expectedTurnDeadlineAt = input.projection?.turnDeadlineAt;
    if (
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0 ||
      typeof expectedTurnDeadlineAt !== "string" ||
      !input.currentPlayerId
    ) return;

    const claim: OkeyTurnTimeoutClaim = {
      expectedVersion,
      expectedTurnDeadlineAt,
      expectedTurnPlayerId: input.currentPlayerId,
    };
    const turnKey = `${expectedVersion}:${expectedTurnDeadlineAt}:${input.currentPlayerId}`;
    if (input.activeTurnKeyRef.current !== turnKey) return;
    void submitTimeoutClaim(claim, turnKey, input.matchId);
  }, [
    input.activeTurnKeyRef,
    input.currentPlayerId,
    input.currentUserId,
    input.projection,
    input.matchId,
    input.timeoutPassInFlightRef,
    input.timeoutRetryRef,
    input.turnTimeLeft,
    submitTimeoutClaim,
  ]);
}

export function useOkeyTurnClock(input: {
  currentPlayerId: string;
  projection: OkeyMatchServerProjection | null;
  serverClockOffsetMsRef: { current: number };
}) {
  const [turnTimeLeft, setTurnTimeLeft] = useState(0);

  useEffect(() => {
    if (
      !input.currentPlayerId ||
      !input.projection?.turnDeadlineAt ||
      input.projection.matchFinished
    ) {
      setTurnTimeLeft(0);
      return;
    }
    const deadlineMs = Date.parse(input.projection.turnDeadlineAt);
    const updateTimer = () => {
      const synchronizedNow = Date.now() + input.serverClockOffsetMsRef.current;
      setTurnTimeLeft(Math.max(0, (deadlineMs - synchronizedNow) / 1000));
    };
    updateTimer();
    const timer = setInterval(updateTimer, 250);
    return () => clearInterval(timer);
  }, [
    input.currentPlayerId,
    input.projection?.turnDeadlineAt,
    input.projection?.matchFinished,
    input.serverClockOffsetMsRef,
  ]);

  return turnTimeLeft;
}