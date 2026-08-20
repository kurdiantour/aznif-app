import type {
  DominoOneVsOneAdapter,
  DominoOneVsOneDrawTimeoutClaim,
  DominoOneVsOneTurnTimeoutClaim,
} from "../adapters/domino-one-vs-one-adapter";
import { MultiplayerRequestError } from "@/lib/multiplayer/core/http-command-client";
import { getSnapshotVersion } from "@/lib/multiplayer/optimisticMove";
import { useCallback, useEffect, useRef, useState } from "react";

const DRAW_PHASE_DURATION_SECONDS = 5;

export function useDominoOneVsOneTimeoutController(args: {
  roomId?: string;
  adapter: DominoOneVsOneAdapter | null;
  rawState: any;
  currentTurnPlayerId: string;
  roundWinnerPlayerId: string | null;
  winningTeamId: string | null;
  currentUserId: string | null;
  turnDurationSeconds: number;
  reconcile: () => Promise<unknown>;
}) {
  const [turnTimeLeft, setTurnTimeLeft] = useState(args.turnDurationSeconds);
  const [drawTimeLeft, setDrawTimeLeft] = useState(DRAW_PHASE_DURATION_SECONDS);
  const roomIdRef = useRef(args.roomId);
  const currentUserIdRef = useRef(args.currentUserId);
  const activeTurnKeyRef = useRef<string | null>(null);
  const activeDrawKeyRef = useRef<string | null>(null);
  const serverClockOffsetMsRef = useRef(0);
  const passInFlightRef = useRef(false);
  const drawInFlightRef = useRef(false);
  const passRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitPassRef = useRef<((claim: DominoOneVsOneTurnTimeoutClaim, key: string, roomId: string) => void) | null>(null);
  const submitDrawRef = useRef<((claim: DominoOneVsOneDrawTimeoutClaim, key: string, roomId: string) => void) | null>(null);

  roomIdRef.current = args.roomId;
  currentUserIdRef.current = args.currentUserId;

  const clearPassRetry = useCallback(() => {
    if (passRetryRef.current) clearTimeout(passRetryRef.current);
    passRetryRef.current = null;
  }, []);
  const clearDrawRetry = useCallback(() => {
    if (drawRetryRef.current) clearTimeout(drawRetryRef.current);
    drawRetryRef.current = null;
  }, []);

  const acceptSnapshot = useCallback((state: any) => {
    const version = getSnapshotVersion(state);
    const playerId = state?.currentTurnPlayerId ?? null;
    const turnStartedAt = state?.turnStartedAt ?? state?.updated_at ?? null;
    activeTurnKeyRef.current =
      version >= 0 && typeof turnStartedAt === "string" && typeof playerId === "string"
        ? `${version}:${turnStartedAt}:${playerId}` : null;
    const drawStartedAt = state?.drawStartedAt ?? null;
    activeDrawKeyRef.current =
      state?.canDrawTile === true && version >= 0 &&
      typeof drawStartedAt === "string" && typeof playerId === "string"
        ? `${version}:${drawStartedAt}:${playerId}` : null;
    clearPassRetry();
    clearDrawRetry();
  }, [clearPassRetry, clearDrawRetry]);

  useEffect(() => () => {
    activeTurnKeyRef.current = null;
    activeDrawKeyRef.current = null;
    passInFlightRef.current = false;
    drawInFlightRef.current = false;
    clearPassRetry();
    clearDrawRetry();
  }, [args.roomId, clearPassRetry, clearDrawRetry]);

  useEffect(() => {
    if (!args.currentTurnPlayerId || args.roundWinnerPlayerId || args.winningTeamId) return;
    if (args.rawState?.canDrawTile === true) return;
    const startedAt = Date.parse(args.rawState?.turnStartedAt ?? args.rawState?.updated_at ?? "");
    const update = () => {
      const elapsed = Number.isFinite(startedAt)
        ? Math.floor((Date.now() + serverClockOffsetMsRef.current - startedAt) / 1000) : 0;
      setTurnTimeLeft(Math.max(0, args.turnDurationSeconds - elapsed));
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [
    args.currentTurnPlayerId,
    args.rawState?.turnStartedAt,
    args.rawState?.updated_at,
    args.rawState?.canDrawTile,
    args.roundWinnerPlayerId,
    args.winningTeamId,
    args.turnDurationSeconds,
  ]);

  useEffect(() => {
    if (
      !args.currentTurnPlayerId || args.roundWinnerPlayerId ||
      args.winningTeamId || args.rawState?.canDrawTile !== true
    ) {
      setDrawTimeLeft(DRAW_PHASE_DURATION_SECONDS);
      return;
    }
    const startedAt = Date.parse(args.rawState?.drawStartedAt ?? "");
    const update = () => {
      const elapsed = Number.isFinite(startedAt)
        ? Math.floor((Date.now() + serverClockOffsetMsRef.current - startedAt) / 1000) : 0;
      setDrawTimeLeft(Math.max(0, DRAW_PHASE_DURATION_SECONDS - elapsed));
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [
    args.currentTurnPlayerId,
    args.rawState?.canDrawTile,
    args.rawState?.drawStartedAt,
    args.roundWinnerPlayerId,
    args.winningTeamId,
  ]);

  const syncClock = useCallback((serverNow: unknown) => {
    if (typeof serverNow !== "string") return;
    const value = Date.parse(serverNow);
    if (Number.isFinite(value)) serverClockOffsetMsRef.current = value - Date.now();
  }, []);

  const submitPass = useCallback(async (
    claim: DominoOneVsOneTurnTimeoutClaim,
    key: string,
    claimRoomId: string,
  ) => {
    if (
      !args.adapter || passInFlightRef.current ||
      roomIdRef.current !== claimRoomId || activeTurnKeyRef.current !== key
    ) return;
    passInFlightRef.current = true;
    try {
      const result = await args.adapter.dispatch({ type: "timeout-pass", claim });
      syncClock(result?.serverNow);
      if (roomIdRef.current !== claimRoomId || activeTurnKeyRef.current !== key) return;
      clearPassRetry();
      if (result.state?.myHandOwnerId && result.state.myHandOwnerId !== currentUserIdRef.current) {
        console.warn("Ignored 1v1 timeout response with mismatched hand owner");
      }
      await args.reconcile();
    } catch (error) {
      const requestError = error instanceof MultiplayerRequestError ? error : null;
      syncClock(requestError?.details?.serverNow);
      if (requestError?.code === "turn_timer_not_expired") {
        clearPassRetry();
        const expiresAt = requestError.details?.expiresAt;
        if (typeof expiresAt === "string") {
          const expiresAtMs = Date.parse(expiresAt);
          if (Number.isFinite(expiresAtMs)) {
            clearPassRetry();
            passRetryRef.current = setTimeout(() => {
              passRetryRef.current = null;
              if (roomIdRef.current === claimRoomId && activeTurnKeyRef.current === key) {
                submitPassRef.current?.(claim, key, claimRoomId);
              }
            }, Math.max(0, expiresAtMs - (Date.now() + serverClockOffsetMsRef.current)));
          } else console.warn("1v1 timeout response has no valid expiresAt");
        }
      } else {
        if (requestError?.code === "stale_timeout" || requestError?.code === "already_processed") {
          clearPassRetry();
        }
        if (roomIdRef.current === claimRoomId) await args.reconcile().catch(() => undefined);
      }
    } finally {
      passInFlightRef.current = false;
    }
  }, [args.adapter, args.reconcile, clearPassRetry, syncClock]);

  const submitDraw = useCallback(async (
    claim: DominoOneVsOneDrawTimeoutClaim,
    key: string,
    claimRoomId: string,
  ) => {
    if (
      !args.adapter || drawInFlightRef.current ||
      roomIdRef.current !== claimRoomId || activeDrawKeyRef.current !== key
    ) return;
    drawInFlightRef.current = true;
    try {
      const result = await args.adapter.dispatch({ type: "timeout-draw", claim });
      syncClock(result?.serverNow);
      if (roomIdRef.current !== claimRoomId || activeDrawKeyRef.current !== key) return;
      clearDrawRetry();
      await args.reconcile();
    } catch (error) {
      const requestError = error instanceof MultiplayerRequestError ? error : null;
      syncClock(requestError?.details?.serverNow);
      if (requestError?.code === "turn_timer_not_expired") {
        clearPassRetry();
        const expiresAt = requestError.details?.expiresAt;
        if (typeof expiresAt === "string") {
          const expiresAtMs = Date.parse(expiresAt);
          if (Number.isFinite(expiresAtMs)) {
            clearDrawRetry();
            drawRetryRef.current = setTimeout(() => {
              drawRetryRef.current = null;
              if (roomIdRef.current === claimRoomId && activeDrawKeyRef.current === key) {
                submitDrawRef.current?.(claim, key, claimRoomId);
              }
            }, Math.max(0, expiresAtMs - (Date.now() + serverClockOffsetMsRef.current)));
          }
        }
      } else {
        if (requestError?.code === "stale_timeout" || requestError?.code === "already_processed") {
          clearDrawRetry();
        }
        if (roomIdRef.current === claimRoomId) await args.reconcile().catch(() => undefined);
      }
    } finally {
      drawInFlightRef.current = false;
    }
  }, [args.adapter, args.reconcile, clearDrawRetry, syncClock]);

  useEffect(() => {
    submitPassRef.current = (claim, key, room) => { void submitPass(claim, key, room); };
    submitDrawRef.current = (claim, key, room) => { void submitDraw(claim, key, room); };
    return () => { submitPassRef.current = null; submitDrawRef.current = null; };
  }, [submitPass, submitDraw]);

  useEffect(() => {
    if (
      !args.roomId || args.rawState?.canDrawTile !== true || drawTimeLeft > 0 ||
      args.roundWinnerPlayerId || args.winningTeamId || drawInFlightRef.current || drawRetryRef.current
    ) return;
    const version = getSnapshotVersion(args.rawState);
    const startedAt = args.rawState?.drawStartedAt;
    if (version < 0 || typeof startedAt !== "string" || !args.currentTurnPlayerId) return;
    const claim = {
      expectedVersion: version,
      expectedDrawStartedAt: startedAt,
      expectedTurnPlayerId: args.currentTurnPlayerId,
    };
    const key = `${version}:${startedAt}:${args.currentTurnPlayerId}`;
    if (activeDrawKeyRef.current === key) void submitDraw(claim, key, args.roomId);
  }, [
    args.roomId, args.rawState, drawTimeLeft, args.roundWinnerPlayerId,
    args.winningTeamId, args.currentTurnPlayerId, submitDraw,
  ]);

  useEffect(() => {
    if (
      !args.roomId || turnTimeLeft > 0 || args.roundWinnerPlayerId ||
      args.rawState?.canDrawTile === true || args.winningTeamId ||
      passInFlightRef.current || passRetryRef.current
    ) return;
    const version = getSnapshotVersion(args.rawState);
    const startedAt = args.rawState?.turnStartedAt ?? args.rawState?.updated_at;
    if (version < 0 || typeof startedAt !== "string" || !args.currentTurnPlayerId) return;
    const claim = {
      expectedVersion: version,
      expectedTurnStartedAt: startedAt,
      expectedTurnPlayerId: args.currentTurnPlayerId,
    };
    const key = `${version}:${startedAt}:${args.currentTurnPlayerId}`;
    if (activeTurnKeyRef.current === key) void submitPass(claim, key, args.roomId);
  }, [
    args.roomId, turnTimeLeft, args.roundWinnerPlayerId, args.winningTeamId,
    args.currentTurnPlayerId, args.rawState, submitPass,
  ]);

  return { turnTimeLeft, drawTimeLeft, acceptSnapshot };
}
