import { RealtimeReconnectPolicy } from "../core/realtime-reconnect";
import { AppState } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MultiplayerMatchOptions,
  MultiplayerMatchPhase,
  MultiplayerTimeoutClaim,
} from "./contracts";
import { createTurnTimeoutClaim, deriveMatchPhase, getTurnIdentity, projectDeadlineMs } from "./lifecycle";
import { MultiplayerSnapshotStore } from "./snapshot-store";
import { BotTurnClaimRegistry } from "../core/bot-turn-orchestration";

const DEFAULT_ROUND_SYNC_MS = 1_500;
const DEFAULT_STALE_MS = 12_000;
const DEFAULT_WATCHDOG_MS = 3_000;

export function useMultiplayerMatch<TSnapshot, TRoundResult, TFinalResult>(
  options: MultiplayerMatchOptions<TSnapshot, TRoundResult, TFinalResult>,
) {
  const selectLifecycle = options.selectLifecycle;
  const buildRoundResult = options.buildRoundResult;
  const buildFinalResult = options.buildFinalResult;
  const getSnapshotServerNow = options.getSnapshotServerNow;
  const getTimeoutError = options.getTimeoutError;
  const canClaimTimeout = options.canClaimTimeout;
  const selectBotTurn = options.selectBotTurn;
  const canExecuteBotTurn = options.canExecuteBotTurn;

  const [snapshot, setSnapshot] = useState<TSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [turnMillisecondsLeft, setTurnMillisecondsLeft] = useState<number | null>(null);
  const [exitConfirmationVisible, setExitConfirmationVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === "active");
  const [resumeCount, setResumeCount] = useState(0);
  const [finalPresentationCompletedFor, setFinalPresentationCompletedFor] = useState<string | null>(null);
  const [roundResultCompletedFor, setRoundResultCompletedFor] = useState<string | null>(null);
  const [roundResultCountdownRemaining, setRoundResultCountdownRemaining] = useState<number | null>(null);

  const storeRef = useRef(new MultiplayerSnapshotStore(options.selectLifecycle));
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectPolicyRef = useRef(new RealtimeReconnectPolicy());
  const lastActivityRef = useRef(Date.now());
  const refreshInFlightRef = useRef<Promise<TSnapshot> | null>(null);
  const timeoutKeyRef = useRef<string | null>(null);
  const timeoutInFlightRef = useRef(false);
  const timeoutRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextRoundStartKeyRef = useRef<string | null>(null);
  const [terminalPresentationCompletedRound, setTerminalPresentationCompletedRound] = useState<string | null>(null);
  const botClaimRegistryRef = useRef(new BotTurnClaimRegistry());
  const mountedRef = useRef(true);

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const clearTimeoutRetry = useCallback(() => {
    if (timeoutRetryRef.current) clearTimeout(timeoutRetryRef.current);
    timeoutRetryRef.current = null;
  }, []);

  const applySnapshot = useCallback((next: TSnapshot) => {
    if (!storeRef.current.apply(next)) return false;
    lastActivityRef.current = Date.now();
    setSnapshot(next);
    return true;
  }, []);

  const refresh = useCallback(async () => {
    if (!options.adapter) throw new Error("Multiplayer adapter is unavailable");
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const request = options.adapter.load();
    refreshInFlightRef.current = request;
    try {
      const next = await request;
      if (mountedRef.current) applySnapshot(next);
      return next;
    } finally {
      if (refreshInFlightRef.current === request) refreshInFlightRef.current = null;
    }
  }, [options.adapter, applySnapshot]);

  const resume = useCallback(async () => {
    if (!options.adapter) return;
    const next = options.adapter.resume
      ? await options.adapter.resume()
      : await options.adapter.load();
    if (mountedRef.current) applySnapshot(next);
  }, [options.adapter, applySnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    storeRef.current = new MultiplayerSnapshotStore(options.selectLifecycle);
    setSnapshot(null);
    setLoading(true);
    setError(null);
    nextRoundStartKeyRef.current = null;
    setTerminalPresentationCompletedRound(null);
    setFinalPresentationCompletedFor(null);
    setRoundResultCompletedFor(null);
    setRoundResultCountdownRemaining(null);
    timeoutKeyRef.current = null;
    timeoutInFlightRef.current = false;
    clearReconnect();
    clearTimeoutRetry();
    reconnectPolicyRef.current.reset();

    if (!options.roomId || !options.adapter) {
      setLoading(false);
      setError("Multiplayer room is unavailable");
      return;
    }

    let active = true;
    let subscribe = () => undefined;
    const scheduleReconnect = (delay: number) => {
      if (reconnectTimerRef.current || !active) return;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (active) subscribe();
      }, delay);
    };
    subscribe = () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = options.adapter!.subscribe({
        onInvalidated: (publicSnapshot) => {
          if (!active) return;
          lastActivityRef.current = Date.now();
          if (publicSnapshot) {
            applySnapshot(publicSnapshot);
            return;
          }
          void refresh().catch((caught) => console.warn("Multiplayer realtime reconcile failed", caught));
        },
        onStatus: (status, statusError) => {
          if (!active) return;
          const delay = reconnectPolicyRef.current.observe(status);
          if (status === "SUBSCRIBED") {
            setError(null);
            void refresh().catch((caught) => console.warn("Multiplayer subscribe reconcile failed", caught));
          } else if (delay !== null) {
            console.warn(`Multiplayer realtime status: ${status}`, statusError);
            scheduleReconnect(delay);
          }
        },
      });
    };

    void refresh()
      .then(() => {
        if (!active) return;
        subscribe();
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setLoading(false);
      });

    return () => {
      active = false;
      mountedRef.current = false;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      clearReconnect();
      clearTimeoutRetry();
    };
  }, [options.roomId, options.adapter, options.selectLifecycle, refresh, clearReconnect, clearTimeoutRetry]);

  useEffect(() => {
    if (!options.roomId || !options.adapter) return;
    const subscription = AppState.addEventListener("change", (state) => {
      setIsAppActive(state === "active");
      if (state !== "active") return;
      void resume().catch((caught) => {
        console.warn("Multiplayer resume reconcile failed", caught);
        void refresh().catch(() => undefined);
      });
      setResumeCount((value) => value + 1);
    });
    return () => subscription.remove();
  }, [options.roomId, options.adapter, resume, refresh]);

  const lifecycle = useMemo(
    () => (snapshot ? selectLifecycle(snapshot) : null),
    [snapshot, selectLifecycle],
  );

  const phase: MultiplayerMatchPhase = useMemo(() => {
    if (loading || !lifecycle) return "loading";
    return deriveMatchPhase(lifecycle);
  }, [loading, lifecycle]);

  const roundResult = useMemo(
    () => (lifecycle?.roundFinished && snapshot ? buildRoundResult(snapshot) : null),
    [lifecycle?.roundFinished, snapshot, buildRoundResult],
  );

  const finalResult = useMemo(
    () => (lifecycle?.matchFinished && snapshot ? buildFinalResult(snapshot) : null),
    [lifecycle?.matchFinished, snapshot, buildFinalResult],
  );

  useEffect(() => {
    if (!options.roomId || loading || phase === "match_finished" || phase === "cancelled") return;
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current < (options.staleAfterMs ?? DEFAULT_STALE_MS)) return;
      void refresh().catch((caught) => console.warn("Multiplayer watchdog reconcile failed", caught));
    }, options.watchdogIntervalMs ?? DEFAULT_WATCHDOG_MS);
    return () => clearInterval(interval);
  }, [options.roomId, loading, phase, options.staleAfterMs, options.watchdogIntervalMs, refresh]);

  const timeoutClaim = useMemo(
    () => {
      if (!lifecycle || !snapshot) return null;
      const claim = createTurnTimeoutClaim(lifecycle);
      return claim && (!canClaimTimeout || canClaimTimeout(snapshot, claim)) ? claim : null;
    },
    [lifecycle, snapshot, canClaimTimeout],
  );

  useEffect(() => {
    clearTimeoutRetry();
    if (!timeoutClaim) {
      timeoutKeyRef.current = null;
      setTurnMillisecondsLeft(null);
      return;
    }
    const key = getTurnIdentity(timeoutClaim);
    timeoutKeyRef.current = key;
    const serverNow = snapshot && getSnapshotServerNow?.(snapshot);
    const parsedServerNow = serverNow ? Date.parse(serverNow) : Number.NaN;
    const offset = Number.isFinite(parsedServerNow) ? parsedServerNow - Date.now() : 0;
    const tick = () => setTurnMillisecondsLeft(projectDeadlineMs(timeoutClaim.expectedTurnDeadlineAt, offset));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [timeoutClaim, snapshot, getSnapshotServerNow, clearTimeoutRetry]);

  useEffect(() => {
    if (
      !options.roomId ||
      !options.adapter?.claimTimeout ||
      !timeoutClaim ||
      turnMillisecondsLeft === null ||
      turnMillisecondsLeft > 0 ||
      timeoutInFlightRef.current ||
      timeoutRetryRef.current
    ) {
      return;
    }

    const key = getTurnIdentity(timeoutClaim);
    if (timeoutKeyRef.current !== key) return;

    timeoutInFlightRef.current = true;
    void options.adapter.claimTimeout(timeoutClaim)
      .then((next) => {
        if (next && mountedRef.current) applySnapshot(next);
        clearTimeoutRetry();
      })
      .catch((caught) => {
        const details = getTimeoutError?.(caught);
        if (details?.code === "turn_timer_not_expired" && details.expiresAt) {
          const expiresAtMs = Date.parse(details.expiresAt);
          const serverNow = details.serverNow ? Date.parse(details.serverNow) : Number.NaN;
          const offset = Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
          if (Number.isFinite(expiresAtMs)) {
            const delay = Math.max(50, expiresAtMs - (Date.now() + offset));
            clearTimeoutRetry();
            timeoutRetryRef.current = setTimeout(() => {
              timeoutRetryRef.current = null;
              void refresh().catch(() => undefined);
            }, delay);
            return;
          }
        }
        clearTimeoutRetry();
        void refresh().catch(() => undefined);
      })
      .finally(() => {
        timeoutInFlightRef.current = false;
      });
  }, [
    options.roomId,
    options.adapter,
    timeoutClaim,
    turnMillisecondsLeft,
    getTimeoutError,
    clearTimeoutRetry,
    applySnapshot,
    refresh,
  ]);

  useEffect(() => {
    if (
      !options.roomId ||
      !options.adapter?.executeBotTurn ||
      !selectBotTurn ||
      !snapshot ||
      !lifecycle ||
      lifecycle.status !== "playing" ||
      lifecycle.roundFinished ||
      lifecycle.matchFinished
    ) {
      return;
    }

    const botTurn = selectBotTurn(snapshot);
    if (!botTurn || !botTurn.controlledByBot) return;
    if (canExecuteBotTurn && !canExecuteBotTurn(snapshot)) return;

    const claim = {
      expectedVersion: lifecycle.version,
      expectedActorId: botTurn.actorId,
    };
    const claimKey = botClaimRegistryRef.current.tryAcquire(options.roomId, claim);
    if (!claimKey) return;

    void options.adapter.executeBotTurn!(claim)
      .then(() => {
        return refresh();
      })
      .catch((caught) => {
        console.warn("Multiplayer bot turn execution failed", caught);
        botClaimRegistryRef.current.release(claimKey);
        void refresh().catch(() => undefined);
      });
  }, [
    options.roomId,
    options.adapter,
    selectBotTurn,
    canExecuteBotTurn,
    snapshot,
    lifecycle,
    refresh,
  ]);

  const completedPresentationKey = lifecycle?.completedRoundId ?? null;

  const completeFinalPresentation = useCallback(() => {
    if (!lifecycle?.roundFinished) return;

    // Terminal presentation completion must always produce a React state update.
    // A ref-only latch can leave Android waiting for an unrelated native event
    // (for example a touch) before the final popup is painted.
    if (lifecycle.matchFinished) {
      setTerminalPresentationCompletedRound(lifecycle.roundId ?? "terminal");
    }

    if (completedPresentationKey) {
      setFinalPresentationCompletedFor(completedPresentationKey);
    }
  }, [completedPresentationKey, lifecycle?.roundFinished, lifecycle?.matchFinished, lifecycle?.roundId]);

  const completeRoundResultPresentation = useCallback(async () => {
    if (
      !completedPresentationKey ||
      !lifecycle?.roundFinished ||
      lifecycle.matchFinished ||
      finalPresentationCompletedFor !== completedPresentationKey ||
      nextRoundStartKeyRef.current === completedPresentationKey ||
      !options.adapter?.startNextRound
    ) {
      return;
    }

    nextRoundStartKeyRef.current = completedPresentationKey;
    setRoundResultCompletedFor(completedPresentationKey);
    try {
      const next = await options.adapter.startNextRound(completedPresentationKey);
      if (next && mountedRef.current) applySnapshot(next);
    } catch (caught) {
      console.warn("Multiplayer start next round failed", caught);
      nextRoundStartKeyRef.current = null;
      setRoundResultCompletedFor(null);
      await refresh().catch(() => undefined);
      throw caught;
    }
  }, [
    completedPresentationKey,
    lifecycle?.roundFinished,
    lifecycle?.matchFinished,
    finalPresentationCompletedFor,
    options.adapter,
    applySnapshot,
    refresh,
  ]);

  const isFinalPresentationComplete =
    phase === "match_finished"
      ? (
          (completedPresentationKey !== null && finalPresentationCompletedFor === completedPresentationKey) ||
          (terminalPresentationCompletedRound !== null &&
            terminalPresentationCompletedRound === (lifecycle?.roundId ?? "terminal"))
        )
      : (
          completedPresentationKey !== null &&
          finalPresentationCompletedFor === completedPresentationKey
        );

  const showRoundResultPopup =
    phase === "round_result" &&
    roundResult !== null &&
    finalPresentationCompletedFor === completedPresentationKey &&
    roundResultCompletedFor !== completedPresentationKey;

  const showFinalMatchPopup =
    phase === "match_finished" &&
    finalResult !== null &&
    isFinalPresentationComplete;

  useEffect(() => {
    if (phase !== "match_finished" || isFinalPresentationComplete) return;
    const timeoutMs = options.terminalPresentationTimeoutMs ?? 6_500;
    const timer = setTimeout(() => {
      completeFinalPresentation();
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [phase, isFinalPresentationComplete, options.terminalPresentationTimeoutMs, completeFinalPresentation]);

  useEffect(() => {
    const durationMs = options.roundResultDurationMs;
    if (!showRoundResultPopup || durationMs === undefined) {
      setRoundResultCountdownRemaining(null);
      return;
    }

    setRoundResultCountdownRemaining(Math.ceil(durationMs / 1_000));
    const countdown = setInterval(() => {
      setRoundResultCountdownRemaining((remaining) =>
        remaining === null ? null : Math.max(0, remaining - 1),
      );
    }, 1_000);
    const complete = setTimeout(() => {
      setRoundResultCountdownRemaining(0);
      void completeRoundResultPresentation().catch(() => undefined);
    }, durationMs);
    return () => {
      clearInterval(countdown);
      clearTimeout(complete);
    };
  }, [showRoundResultPopup, options.roundResultDurationMs, completeRoundResultPresentation]);
  useEffect(() => {
    if (!lifecycle?.roundFinished || lifecycle.matchFinished) return;
    const interval = setInterval(
      () => void refresh().catch(() => undefined),
      options.roundSyncIntervalMs ?? DEFAULT_ROUND_SYNC_MS,
    );
    return () => clearInterval(interval);
  }, [lifecycle?.roundFinished, lifecycle?.matchFinished, options.roundSyncIntervalMs, refresh]);

  const requestExit = useCallback(() => setExitConfirmationVisible(true), []);
  const cancelExit = useCallback(() => setExitConfirmationVisible(false), []);
  const confirmExit = useCallback(async () => {
    if (!options.adapter || leaving) return;
    setLeaving(true);
    try {
      await options.adapter.leave();
      setExitConfirmationVisible(false);
    } finally {
      setLeaving(false);
    }
  }, [options.adapter, leaving]);

  return {
    snapshot,
    lifecycle,
    phase,
    loading,
    error,
    refresh,
    resume,
    applySnapshot,
    roundResult,
    finalResult,
    showRoundResultPopup,
    showFinalMatchPopup,
    finalPresentationComplete: isFinalPresentationComplete,
    completeFinalPresentation,
    completeRoundResultPresentation,
    roundResultCountdownRemaining,
    turnMillisecondsLeft,
    turnSecondsLeft: turnMillisecondsLeft === null ? null : Math.ceil(turnMillisecondsLeft / 1_000),
    exitConfirmationVisible,
    leaving,
    isAppActive,
    resumeCount,
    requestExit,
    cancelExit,
    confirmExit,
  };
}

