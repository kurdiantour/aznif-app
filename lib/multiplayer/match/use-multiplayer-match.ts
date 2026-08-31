import { RealtimeReconnectPolicy } from "../core/realtime-reconnect";
import { AppState } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MultiplayerMatchOptions,
  MultiplayerMatchPhase,
  MultiplayerTimeoutClaim,
} from "./contracts";
import { createTurnTimeoutClaim, getTurnIdentity, projectDeadlineMs } from "./lifecycle";
import { MultiplayerSnapshotStore } from "./snapshot-store";
import { BotTurnClaimRegistry, createBotTurnClaim } from "../core/bot-turn-orchestration";
import { projectSeatOwnership } from "../core/seat-ownership";

const DEFAULT_ROUND_RESULT_MS = 3_000;
const DEFAULT_COUNTDOWN_SECONDS = 3;
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
  const botRetryDelayMs = options.botRetryDelayMs;
  const [snapshot, setSnapshot] = useState<TSnapshot | null>(null);
  const [phase, setPhase] = useState<MultiplayerMatchPhase>("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roundResult, setRoundResult] = useState<TRoundResult | null>(null);
  const [finalResult, setFinalResult] = useState<TFinalResult | null>(null);
  const [nextRoundCountdown, setNextRoundCountdown] = useState(
    options.nextRoundCountdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS,
  );
  const [turnMillisecondsLeft, setTurnMillisecondsLeft] = useState<number | null>(null);
  const [exitConfirmationVisible, setExitConfirmationVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === "active");
  const [resumeCount, setResumeCount] = useState(0);
  const [botRetryToken, setBotRetryToken] = useState(0);

  const storeRef = useRef(new MultiplayerSnapshotStore(options.selectLifecycle));
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectPolicyRef = useRef(new RealtimeReconnectPolicy());
  const lastActivityRef = useRef(Date.now());
  const refreshInFlightRef = useRef<Promise<TSnapshot> | null>(null);
  const timeoutKeyRef = useRef<string | null>(null);
  const timeoutInFlightRef = useRef(false);
  const timeoutRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presentationKeyRef = useRef<string | null>(null);
  const presentationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextRoundStartKeyRef = useRef<string | null>(null);
  const observedNonTerminalRef = useRef(false);
  const botClaimRegistryRef = useRef(new BotTurnClaimRegistry());
  const activeBotClaimKeyRef = useRef<string | null>(null);
  const botRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);
  const clearTimeoutRetry = useCallback(() => {
    if (timeoutRetryRef.current) clearTimeout(timeoutRetryRef.current);
    timeoutRetryRef.current = null;
  }, []);
  const clearPresentationTimer = useCallback(() => {
    if (presentationTimerRef.current) clearTimeout(presentationTimerRef.current);
    presentationTimerRef.current = null;
  }, []);
  const clearBotRetry = useCallback(() => {
    if (botRetryRef.current) clearTimeout(botRetryRef.current);
    botRetryRef.current = null;
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
    setPhase("loading");
    setLoading(true);
    setError(null);
    presentationKeyRef.current = null;
    nextRoundStartKeyRef.current = null;
    observedNonTerminalRef.current = false;
    timeoutKeyRef.current = null;
    clearReconnect();
    clearTimeoutRetry();
    clearPresentationTimer();
    clearBotRetry();
    activeBotClaimKeyRef.current = null;
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
      clearPresentationTimer();
      clearBotRetry();
    };
  }, [options.roomId, options.adapter, options.selectLifecycle, refresh, clearReconnect, clearTimeoutRetry, clearPresentationTimer, clearBotRetry]);

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

  useEffect(() => {
    if (!options.roomId || loading || phase === "match_finished" || phase === "cancelled") return;
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current < (options.staleAfterMs ?? DEFAULT_STALE_MS)) return;
      void refresh().catch((caught) => console.warn("Multiplayer watchdog reconcile failed", caught));
    }, options.watchdogIntervalMs ?? DEFAULT_WATCHDOG_MS);
    return () => clearInterval(interval);
  }, [options.roomId, loading, phase, options.staleAfterMs, options.watchdogIntervalMs, refresh]);

  const lifecycle = useMemo(
    () => snapshot ? selectLifecycle(snapshot) : null,
    [snapshot, selectLifecycle],
  );

  useEffect(() => {
    if (!snapshot || !lifecycle) return;
    if (lifecycle.status === "cancelled") {
      setPhase("cancelled");
      return;
    }
    if (!lifecycle.roundFinished && !lifecycle.matchFinished) {
      observedNonTerminalRef.current = true;
      presentationKeyRef.current = null;
      nextRoundStartKeyRef.current = null;
      clearPresentationTimer();
      setRoundResult(null);
      setFinalResult(null);
      setPhase(lifecycle.status === "playing" ? "playing" : "waiting");
      return;
    }
    const key = lifecycle.completedRoundId ?? lifecycle.roundId ?? String(lifecycle.version);
    if (presentationKeyRef.current === key) return;
    clearPresentationTimer();
    presentationKeyRef.current = key;
    const terminalPresentation = options.terminalRoundPresentation ?? "always";
    const shouldPresentTerminalRound = !lifecycle.matchFinished ||
      terminalPresentation === "always" ||
      (terminalPresentation === "transition-only" && observedNonTerminalRef.current);
    const nextRoundResult = shouldPresentTerminalRound ? buildRoundResult(snapshot) : null;
    const nextFinalResult = lifecycle.matchFinished ? buildFinalResult(snapshot) : null;
    setRoundResult(nextRoundResult);
    setFinalResult(nextFinalResult);
    setPhase(nextRoundResult ? "round_result" : lifecycle.matchFinished ? "match_finished" : "next_round_countdown");

    const terminalDuration = options.terminalRoundResultDurationMs;
    if (lifecycle.matchFinished && nextRoundResult && terminalDuration === null) return;
    const serverNowValue = getSnapshotServerNow?.(snapshot);
    const serverNowMs = Date.parse(serverNowValue ?? "");
    const eligibleAtMs = Date.parse(lifecycle.nextRoundEligibleAt ?? "");
    const presentationClockOffsetMs = Number.isFinite(serverNowMs) ? serverNowMs - Date.now() : 0;
    const countdownSeconds = options.nextRoundCountdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS;
    const authoritativeRevealMs = Number.isFinite(serverNowMs) && Number.isFinite(eligibleAtMs)
      ? Math.max(0, eligibleAtMs - countdownSeconds * 1_000 - serverNowMs)
      : null;
    presentationTimerRef.current = setTimeout(() => {
      presentationTimerRef.current = null;
      if (!mountedRef.current || presentationKeyRef.current !== key) return;
      if (lifecycle.matchFinished) {
        setPhase("match_finished");
        return;
      }
      const remaining = Number.isFinite(eligibleAtMs)
        ? Math.min(countdownSeconds, Math.max(0, Math.ceil((eligibleAtMs - (Date.now() + presentationClockOffsetMs)) / 1_000)))
        : countdownSeconds;
      setNextRoundCountdown(remaining);
      setPhase("next_round_countdown");
    }, nextRoundResult ? (
      lifecycle.matchFinished
        ? terminalDuration ?? options.roundResultDurationMs ?? DEFAULT_ROUND_RESULT_MS
        : authoritativeRevealMs ?? options.roundResultDurationMs ?? DEFAULT_ROUND_RESULT_MS
    ) : 0);
  }, [snapshot, lifecycle, buildRoundResult, buildFinalResult, getSnapshotServerNow, options.roundResultDurationMs, options.terminalRoundResultDurationMs, options.terminalRoundPresentation, options.nextRoundCountdownSeconds, clearPresentationTimer]);

  useEffect(() => {
    if (phase !== "next_round_countdown" || !lifecycle || lifecycle.matchFinished) return;
    if (nextRoundCountdown <= 0) return;
    const timer = setTimeout(() => setNextRoundCountdown((value) => Math.max(0, value - 1)), 1_000);
    return () => clearTimeout(timer);
  }, [phase, lifecycle, nextRoundCountdown]);

  useEffect(() => {
    if (phase !== "next_round_countdown" || nextRoundCountdown !== 0 || !lifecycle?.completedRoundId) return;
    if (!options.adapter?.startNextRound) return;
    const completedRoundId = lifecycle.completedRoundId;
    if (nextRoundStartKeyRef.current === completedRoundId) return;
    nextRoundStartKeyRef.current = completedRoundId;
    void options.adapter.startNextRound(completedRoundId)
      .then((next) => { if (next) applySnapshot(next); })
      .catch((caught) => {
        nextRoundStartKeyRef.current = null;
        console.warn("Multiplayer next round failed", caught);
        void refresh().catch(() => undefined);
      });
  }, [phase, nextRoundCountdown, lifecycle, options.adapter, applySnapshot, refresh]);

  useEffect(() => {
    if (!lifecycle?.roundFinished || lifecycle.matchFinished) return;
    const interval = setInterval(() => void refresh().catch(() => undefined), options.roundSyncIntervalMs ?? DEFAULT_ROUND_SYNC_MS);
    return () => clearInterval(interval);
  }, [lifecycle?.roundFinished, lifecycle?.matchFinished, options.roundSyncIntervalMs, refresh]);

  const timeoutClaim = useMemo(
    () => {
      if (!lifecycle || !snapshot) return null;
      const claim = createTurnTimeoutClaim(lifecycle);
      return claim && (!canClaimTimeout || canClaimTimeout(snapshot, claim)) ? claim : null;
    },
    [lifecycle, snapshot, canClaimTimeout],
  );

  const botTurn = useMemo(
    () => snapshot && selectBotTurn ? selectBotTurn(snapshot) : null,
    [snapshot, selectBotTurn],
  );
  useEffect(() => {
    if (
      !snapshot || !lifecycle || !botTurn || !botTurn.controlledByBot ||
      lifecycle.status !== "playing" || lifecycle.roundFinished || lifecycle.matchFinished ||
      !options.adapter?.executeBotTurn ||
      (canExecuteBotTurn && !canExecuteBotTurn(snapshot))
    ) {
      activeBotClaimKeyRef.current = null;
      clearBotRetry();
      return;
    }
    const ownership = projectSeatOwnership({
      seatId: botTurn.actorId,
      ownerPlayerId: botTurn.actorId,
      controlledByBot: true,
    });
    const claim = createBotTurnClaim({
      version: lifecycle.version,
      actorId: botTurn.actorId,
      ownership,
    });
    if (!claim || !options.roomId) return;
    const claimKey = `${options.roomId}:${claim.expectedVersion}:${claim.expectedActorId}`;
    if (activeBotClaimKeyRef.current === claimKey || botRetryRef.current) return;
    const serverNowValue = getSnapshotServerNow?.(snapshot);
    const serverNowMs = Date.parse(serverNowValue ?? "");
    const notBeforeMs = Date.parse(botTurn.notBefore ?? "");
    const delay = Number.isFinite(notBeforeMs)
      ? Math.max(0, notBeforeMs - (Number.isFinite(serverNowMs) ? serverNowMs : Date.now()))
      : 0;
    const run = () => {
      const registryKey = botClaimRegistryRef.current.tryAcquire(options.roomId!, claim);
      if (!registryKey) return;
      activeBotClaimKeyRef.current = claimKey;
      void options.adapter!.executeBotTurn!(claim)
        .then((next) => { if (next) applySnapshot(next); return refresh(); })
        .catch(async (caught) => {
          console.warn("Multiplayer bot turn failed", caught);
          await refresh().catch(() => undefined);
          if (activeBotClaimKeyRef.current === claimKey) {
            activeBotClaimKeyRef.current = null;
            botRetryRef.current = setTimeout(() => {
              botRetryRef.current = null;
              setBotRetryToken((value) => value + 1);
            }, botRetryDelayMs ?? 1_000);
          }
        })
        .finally(() => botClaimRegistryRef.current.release(registryKey));
    };
    if (delay > 0) {
      botRetryRef.current = setTimeout(() => {
        botRetryRef.current = null;
        run();
      }, delay);
      return clearBotRetry;
    }
    run();
  }, [snapshot, lifecycle, botTurn, botRetryToken, options.adapter, options.roomId, canExecuteBotTurn, botRetryDelayMs, getSnapshotServerNow, applySnapshot, refresh, clearBotRetry]);
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

  const submitTimeoutRef = useRef<(claim: MultiplayerTimeoutClaim, key: string) => void>(() => undefined);
  const submitTimeout = useCallback(async (claim: MultiplayerTimeoutClaim, key: string) => {
    if (!options.adapter?.claimTimeout || timeoutInFlightRef.current || timeoutKeyRef.current !== key) return;
    timeoutInFlightRef.current = true;
    try {
      const next = await options.adapter.claimTimeout(claim);
      if (next && timeoutKeyRef.current === key) applySnapshot(next);
      await refresh();
    } catch (caught) {
      const details = getTimeoutError?.(caught) ?? {};
      if (details.code === "turn_timer_not_expired" && details.expiresAt) {
        const serverNowMs = details.serverNow ? Date.parse(details.serverNow) : Date.now();
        const expiresAtMs = Date.parse(details.expiresAt);
        if (Number.isFinite(serverNowMs) && Number.isFinite(expiresAtMs)) {
          timeoutRetryRef.current = setTimeout(() => submitTimeoutRef.current(claim, key), Math.max(0, expiresAtMs - serverNowMs));
        }
      } else {
        await refresh().catch(() => undefined);
      }
    } finally {
      timeoutInFlightRef.current = false;
    }
  }, [options.adapter, getTimeoutError, applySnapshot, refresh]);
  submitTimeoutRef.current = (claim, key) => { void submitTimeout(claim, key); };

  useEffect(() => {
    if (!timeoutClaim || turnMillisecondsLeft === null || turnMillisecondsLeft > 0 || !options.adapter?.claimTimeout) return;
    const key = getTurnIdentity(timeoutClaim);
    if (timeoutKeyRef.current === key && !timeoutRetryRef.current) void submitTimeout(timeoutClaim, key);
  }, [timeoutClaim, turnMillisecondsLeft, options.adapter, submitTimeout]);

  const requestExit = useCallback(() => setExitConfirmationVisible(true), []);
  const cancelExit = useCallback(() => setExitConfirmationVisible(false), []);
  const confirmExit = useCallback(async () => {
    if (!options.adapter || leaving) return;
    setLeaving(true);
    try {
      await options.adapter.leave();
      setExitConfirmationVisible(false);
      setPhase("exited");
    } finally {
      setLeaving(false);
    }
  }, [options.adapter, leaving]);

  const completeRoundResultPresentation = useCallback(() => {
    if (!lifecycle?.matchFinished || phase !== "round_result") return;
    clearPresentationTimer();
    setPhase("match_finished");
  }, [lifecycle?.matchFinished, phase, clearPresentationTimer]);

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
    showRoundResultPopup: phase === "round_result" && roundResult !== null,
    showFinalMatchPopup: phase === "match_finished" && finalResult !== null,
    completeRoundResultPresentation,
    nextRoundCountdown,
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
