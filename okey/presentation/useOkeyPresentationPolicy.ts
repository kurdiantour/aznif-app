import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";

import type { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";
import { shouldShowOkeyFinalTilePresentation } from "@/okey/presentation/okey-round-presentation";
import type { OkeyTile } from "@/okey/types/okey";

export function useOkeyAdapterPresentationLifecycle({ adapter, showKonkanReveal, resetOverlays }: {
  adapter: SupabaseOkeyMatchAdapter | null;
  showKonkanReveal: (runTiles: OkeyTile[], completionMeldTiles: OkeyTile[]) => void;
  resetOverlays: () => void;
}) {
  useEffect(() => {
    if (!adapter) return;
    const unsubscribeEvents = adapter.subscribeActionEvents((event) => {
      if (event.type === "konkan" && event.payload?.kind === "declare") {
        showKonkanReveal(
          (event.payload.runTiles as OkeyTile[]) ?? [],
          (event.payload.completionMeldTiles as OkeyTile[]) ?? [],
        );
      }
    });
    const unsubscribeReset = adapter.subscribeReset(resetOverlays);
    return () => { unsubscribeEvents(); unsubscribeReset(); };
  }, [adapter, resetOverlays, showKonkanReveal]);
}

export function useOkeyForcedKonkanPresentation(forcedTeamId?: string | null, roundStartsAt?: string | null) {
  const [visible, setVisible] = useState(false);
  const [panelProgress] = useState(() => new Animated.Value(0));
  const [countdownProgress] = useState(() => new Animated.Value(1));
  const endsAt = forcedTeamId ? Date.parse(roundStartsAt ?? "") : Number.NaN;

  useEffect(() => {
    const panelAnimation = Animated.timing(panelProgress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 360 : 260,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    panelAnimation.start();
    countdownProgress.stopAnimation();
    if (visible) {
      countdownProgress.setValue(1);
      Animated.timing(countdownProgress, {
        toValue: 0,
        duration: Math.max(0, endsAt - Date.now()),
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    }
    return () => panelAnimation.stop();
  }, [countdownProgress, endsAt, panelProgress, visible]);

  useEffect(() => {
    const remainingMs = endsAt - Date.now();
    const nextVisible = Number.isFinite(endsAt) && remainingMs > 0;
    const update = setTimeout(() => setVisible(nextVisible), 0);
    const expiry = nextVisible ? setTimeout(() => setVisible(false), remainingMs) : null;
    return () => { clearTimeout(update); if (expiry) clearTimeout(expiry); };
  }, [endsAt]);

  return { visible, panelProgress, countdownProgress };
}

export function useOkeyTimeoutWarningPresentation(input: {
  currentRound: number;
  deadlineAt: string | null;
  durationSeconds: number | null;
  playerId: string | null;
  hasDrawn: boolean;
  ready: boolean;
  appActive: boolean;
  humanTurn: boolean;
  timeLeft: number;
  showWarning: (visible: boolean) => void;
  emitWarning: (key: string) => void;
}) {
  const shownKeyRef = useRef<string | null>(null);
  const observedDeadlineRef = useRef<string | null>(null);
  const { currentRound, deadlineAt, durationSeconds, playerId, hasDrawn, ready, appActive, humanTurn, timeLeft, showWarning, emitWarning } = input;

  useEffect(() => {
    const reset = setTimeout(() => showWarning(false), 0);
    shownKeyRef.current = null;
    observedDeadlineRef.current = null;
    return () => clearTimeout(reset);
  }, [currentRound, deadlineAt, durationSeconds, playerId, hasDrawn, showWarning]);

  useEffect(() => {
    if (!deadlineAt) { observedDeadlineRef.current = null; return; }
    if (observedDeadlineRef.current !== deadlineAt) { observedDeadlineRef.current = deadlineAt; return; }
    if (!ready || !appActive || !humanTurn || !playerId || timeLeft <= 0 || timeLeft > 5) return;
    const key = `${playerId}:${deadlineAt}`;
    if (shownKeyRef.current === key) return;
    shownKeyRef.current = key;
    showWarning(true);
    emitWarning(key);
  }, [appActive, deadlineAt, emitWarning, humanTurn, playerId, ready, showWarning, timeLeft]);
}

export function useOkeyFinalTilePresentationPolicy(input: {
  phase: "playing" | "finished";
  finalPresentationComplete: boolean;
  hasQueuedPresentation: boolean;
  tileFlightActive: boolean;
  roundResultVisible: boolean;
  matchResultVisible: boolean;
  konkanRevealVisible: boolean;
  setVisible: (visible: boolean) => void;
}) {
  const { phase, finalPresentationComplete, hasQueuedPresentation, tileFlightActive, roundResultVisible, matchResultVisible, konkanRevealVisible, setVisible } = input;
  useEffect(() => {
    const shouldShow = shouldShowOkeyFinalTilePresentation({
      phase,
      finalPresentationComplete,
      hasQueuedPresentation,
      tileFlightActive,
      roundResultVisible,
      matchResultVisible,
      konkanRevealVisible,
    });
    const update = setTimeout(() => {
      if (shouldShow) setVisible(true);
      else if (phase !== "finished" || finalPresentationComplete) setVisible(false);
    }, 0);
    return () => clearTimeout(update);
  }, [finalPresentationComplete, hasQueuedPresentation, konkanRevealVisible, matchResultVisible, phase, roundResultVisible, setVisible, tileFlightActive]);
}

export function useOkeyPresentationBoundary(key: string | number, onBoundary: () => void) {
  const previousKeyRef = useRef(key);
  const onBoundaryRef = useRef(onBoundary);
  useLayoutEffect(() => { onBoundaryRef.current = onBoundary; }, [onBoundary]);
  useEffect(() => {
    if (previousKeyRef.current === key) return;
    previousKeyRef.current = key;
    onBoundaryRef.current();
  }, [key]);
}

export function useOkeyStagedMeldCleanup(
  authoritativeOpened: boolean,
  stagedMeldCount: number,
  clearStagedMelds: () => void,
) {
  useEffect(() => {
    if (!authoritativeOpened || stagedMeldCount === 0) return;
    clearStagedMelds();
  }, [authoritativeOpened, clearStagedMelds, stagedMeldCount]);
}