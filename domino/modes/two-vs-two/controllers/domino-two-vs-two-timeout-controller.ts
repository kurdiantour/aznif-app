import { useCallback, useEffect, useState } from 'react';
import { projectDominoTurnSecondsLeft } from '@/domino/shared/timing/domino-turn-timer';
import { MultiplayerRequestError } from '@/lib/multiplayer/core/http-command-client';
import type { DominoTwoVsTwoTurnTimeoutClaim } from '../adapters/domino-two-vs-two-adapter';
import { getSnapshotVersion } from '@/lib/multiplayer/core/versioning';
import type { DominoTwoVsTwoAdapter } from '../adapters/domino-two-vs-two-adapter';

type Mutable<T> = { current: T };

export function useDominoTwoVsTwoTimeoutController(input: {
  roomId?: string;
  turnTimeLeft: number;
  currentTurnPlayerId: string;
  rawState: any;
  currentUserId: string | null;
  adapter: DominoTwoVsTwoAdapter | null;
  refreshSnapshot: () => Promise<any>;
  roomIdRef: Mutable<string | undefined>;
  activeTurnKeyRef: Mutable<string | null>;
  serverClockOffsetMsRef: Mutable<number>;
  timeoutPassInFlightRef: Mutable<boolean>;
  timeoutRetryRef: Mutable<ReturnType<typeof setTimeout> | null>;
  timeoutSubmitRef: Mutable<(
    (claim: DominoTwoVsTwoTurnTimeoutClaim, turnKey: string, roomId: string) => void
  ) | null>;
  clearTimeoutRetry: () => void;
}) {
  const syncServerClock = useCallback((serverNow: unknown) => {
    if (typeof serverNow !== 'string') return false;
    const serverNowMs = Date.parse(serverNow);
    if (!Number.isFinite(serverNowMs)) return false;
    input.serverClockOffsetMsRef.current = serverNowMs - Date.now();
    return true;
  }, [input.serverClockOffsetMsRef]);

  const scheduleTimeoutRetry = useCallback((
    claim: DominoTwoVsTwoTurnTimeoutClaim,
    turnKey: string,
    claimRoomId: string,
    expiresAt: unknown,
  ) => {
    input.clearTimeoutRetry();
    if (
      input.roomIdRef.current !== claimRoomId ||
      input.activeTurnKeyRef.current !== turnKey ||
      typeof expiresAt !== 'string'
    ) return;
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      console.warn('submit_two_vs_two timeout response has no valid expiresAt');
      return;
    }
    const synchronizedNow = Date.now() + input.serverClockOffsetMsRef.current;
    input.timeoutRetryRef.current = setTimeout(() => {
      input.timeoutRetryRef.current = null;
      if (
        input.roomIdRef.current === claimRoomId &&
        input.activeTurnKeyRef.current === turnKey
      ) input.timeoutSubmitRef.current?.(claim, turnKey, claimRoomId);
    }, Math.max(0, expiresAtMs - synchronizedNow));
  }, [
    input.activeTurnKeyRef,
    input.clearTimeoutRetry,
    input.roomIdRef,
    input.serverClockOffsetMsRef,
    input.timeoutRetryRef,
    input.timeoutSubmitRef,
  ]);

  const submitTimeoutClaim = useCallback(async (
    claim: DominoTwoVsTwoTurnTimeoutClaim,
    turnKey: string,
    claimRoomId: string,
  ) => {
    if (
      !input.adapter ||
      input.timeoutPassInFlightRef.current ||
      input.roomIdRef.current !== claimRoomId ||
      input.activeTurnKeyRef.current !== turnKey
    ) return;
    input.timeoutPassInFlightRef.current = true;
    try {
      const result = await input.adapter.dispatch({ type: 'timeout-pass', claim });
      syncServerClock(result?.serverNow);
      if (
        input.roomIdRef.current !== claimRoomId ||
        input.activeTurnKeyRef.current !== turnKey
      ) return;
      input.clearTimeoutRetry();
      if (
        result.state?.myHandOwnerId &&
        result.state.myHandOwnerId !== input.currentUserId
      ) console.warn('Ignored 2v2 timeout response with mismatched hand owner');
      await input.refreshSnapshot();
    } catch (caught) {
      const error = caught instanceof MultiplayerRequestError ? caught : null;
      const response = error?.details;
      syncServerClock(response?.serverNow);
      if (error?.code === 'turn_timer_not_expired') {
        scheduleTimeoutRetry(claim, turnKey, claimRoomId, response?.expiresAt);
        return;
      }
      if (error?.code === 'stale_timeout' || error?.code === 'already_processed') {
        input.clearTimeoutRetry();
      }
      if (input.roomIdRef.current === claimRoomId) {
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
    input.roomIdRef,
    input.timeoutPassInFlightRef,
    scheduleTimeoutRetry,
    syncServerClock,
  ]);

  useEffect(() => {
    input.timeoutSubmitRef.current = (claim, turnKey, roomId) => {
      void submitTimeoutClaim(claim, turnKey, roomId);
    };
    return () => {
      input.timeoutSubmitRef.current = null;
    };
  }, [input.timeoutSubmitRef, submitTimeoutClaim]);

  useEffect(() => {
    if (
      !input.roomId ||
      input.turnTimeLeft > 0 ||
      input.rawState?.roundWinnerPlayerId ||
      input.rawState?.winningTeamId ||
      input.timeoutPassInFlightRef.current ||
      input.timeoutRetryRef.current
    ) return;
    const expectedVersion = getSnapshotVersion(input.rawState);
    const expectedTurnStartedAt =
      input.rawState?.turnStartedAt ?? input.rawState?.updated_at;
    if (
      expectedVersion < 0 ||
      typeof expectedTurnStartedAt !== 'string' ||
      !input.currentTurnPlayerId
    ) return;
    const claim: DominoTwoVsTwoTurnTimeoutClaim = {
      expectedVersion,
      expectedTurnStartedAt,
      expectedTurnPlayerId: input.currentTurnPlayerId,
    };
    const turnKey =
      `${expectedVersion}:${expectedTurnStartedAt}:${input.currentTurnPlayerId}`;
    if (input.activeTurnKeyRef.current !== turnKey) return;
    void submitTimeoutClaim(claim, turnKey, input.roomId);
  }, [
    input.activeTurnKeyRef,
    input.currentTurnPlayerId,
    input.rawState,
    input.roomId,
    input.timeoutPassInFlightRef,
    input.timeoutRetryRef,
    input.turnTimeLeft,
    submitTimeoutClaim,
  ]);
}

export function useDominoTwoVsTwoTurnClock(input: {
  currentTurnPlayerId: string;
  rawState: any;
  serverClockOffsetMsRef: { current: number };
  durationSeconds: number;
}) {
  const [turnTimeLeft, setTurnTimeLeft] = useState(input.durationSeconds);

  useEffect(() => {
    if (
      !input.currentTurnPlayerId ||
      input.rawState?.roundWinnerPlayerId ||
      input.rawState?.winningTeamId
    ) return;
    const turnStartedAt = Date.parse(
      input.rawState?.turnStartedAt ?? input.rawState?.updated_at ?? '',
    );
    const updateTimer = () => {
      setTurnTimeLeft(projectDominoTurnSecondsLeft({
        turnStartedAtMs: turnStartedAt,
        nowMs: Date.now() + input.serverClockOffsetMsRef.current,
        durationSeconds: input.durationSeconds,
      }));
    };
    updateTimer();
    const timer = setInterval(updateTimer, 250);
    return () => clearInterval(timer);
  }, [
    input.currentTurnPlayerId,
    input.rawState?.turnStartedAt,
    input.rawState?.updated_at,
    input.rawState?.roundWinnerPlayerId,
    input.rawState?.winningTeamId,
    input.serverClockOffsetMsRef,
    input.durationSeconds,
  ]);

  return turnTimeLeft;
}