import { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";
import { createInitialOkeyGame, getRoundResultScoreDetails } from "@/okey/engine/okey-engine";
import { projectOkeyServerState } from "@/okey/presentation/okey-server-projection";
import { OKEY_RULESET_V1 } from "@/okey/rules/okey-ruleset-v1";
import type { OkeyAuthoritativeCommand, OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";
import type { OkeyDrawSource, OkeyGameState, OkeyMeld, OkeyTeamId } from "@/okey/types/okey";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

export type OkeyRoundResult = {
  round: number;
  scoreDetails: ReturnType<typeof getRoundResultScoreDetails>;
  winnerId: string | null;
  winnerTeamId: OkeyTeamId | null;
  endReason: OkeyGameState["endReason"];
};

const projectResults = (projection: OkeyMatchServerProjection): OkeyRoundResult[] =>
  projection.roundResults.map((result) => ({
    round: result.round, winnerId: result.winnerId, winnerTeamId: result.winnerTeamId,
    endReason: result.endReason,
    scoreDetails: { scores: { teamA: result.teamAScore, teamB: result.teamBScore }, details: [] },
  }));

export type OkeyEndRoundPresentationStage =
  "idle" | "draining" | "final-tile" | "score" | "cycle-limit" | "complete";

export const OKEY_SCORE_PRESENTATION_MS = 3_000;
export const OKEY_TILE_CYCLE_ANNOUNCEMENT_MS = 4_000;

export function useOkeyMultiplayerGame(matchId?: string, currentUserId: string | null = null) {
  const adapter = useMemo(() => matchId ? new SupabaseOkeyMatchAdapter(matchId) : null, [matchId]);

  const [projection, setProjection] = useState<OkeyMatchServerProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastVersionRef = useRef(-1);
  const mountedRef = useRef(true);

  const applySnapshot = useCallback((next: OkeyMatchServerProjection) => {
    if (!Number.isSafeInteger(next.version) || next.version < 0) return false;
    if (next.version < lastVersionRef.current) return false;
    lastVersionRef.current = next.version;
    setProjection(next);
    return true;
  }, []);

  const refresh = useCallback(async () => {
    if (!adapter) throw new Error("Multiplayer adapter is unavailable");
    await adapter.refresh();
    const next = adapter.getSnapshot();
    if (next && mountedRef.current) applySnapshot(next);
    return next;
  }, [adapter, applySnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    lastVersionRef.current = -1;
    setProjection(null);
    setLoading(true);
    setError(null);

    if (!matchId || !adapter) {
      setLoading(false);
      setError("Multiplayer room is unavailable");
      return;
    }

    let active = true;

    const unsubscribe = adapter.subscribe((next) => {
      if (!active) return;
      applySnapshot(next);
    });

    void refresh()
      .then(() => {
        if (!active) return;
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
      unsubscribe();
    };
  }, [matchId, adapter, refresh, applySnapshot]);

  const [isAppActive, setIsAppActive] = useState(AppState.currentState === "active");
  const [resumeCount, setResumeCount] = useState(0);

  useEffect(() => {
    if (!matchId || !adapter) return;
    const subscription = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      setIsAppActive(active);
      if (!active) return;
      void adapter.reconnect().catch((caught) => {
        console.warn("Multiplayer resume reconcile failed", caught);
        void refresh().catch(() => undefined);
      });
      setResumeCount((value) => value + 1);
    });
    return () => subscription.remove();
  }, [matchId, adapter, refresh]);

  const [turnMillisecondsLeft, setTurnMillisecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const deadlineAt =
      projection?.phase === "playing" && !projection.matchFinished
        ? projection.turnDeadlineAt
        : null;

    if (!deadlineAt) {
      setTurnMillisecondsLeft(null);
      return;
    }

    const offset = adapter ? adapter.getServerClockOffsetMs() : 0;
    const tick = () => {
      const deadline = Date.parse(deadlineAt);
      if (!Number.isFinite(deadline)) {
        setTurnMillisecondsLeft(null);
        return;
      }
      setTurnMillisecondsLeft(Math.max(0, deadline - (Date.now() + offset)));
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [adapter, projection?.phase, projection?.matchFinished, projection?.turnDeadlineAt]);

  const [exitConfirmationVisible, setExitConfirmationVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const requestExit = useCallback(() => setExitConfirmationVisible(true), []);
  const cancelExit = useCallback(() => setExitConfirmationVisible(false), []);
  const confirmExit = useCallback(async () => {
    if (!adapter || leaving) return;
    setLeaving(true);
    try {
      await adapter.leave();
      setProjection(null);
      setExitConfirmationVisible(false);
    } finally {
      setLeaving(false);
    }
  }, [adapter, leaving]);

  const [completedRoundFrame, setCompletedRoundFrame] = useState<OkeyMatchServerProjection | null>(null);
  const [endRoundPresentationStage, setEndRoundPresentationStage] =
    useState<OkeyEndRoundPresentationStage>("idle");
  const [terminalPresentationComplete, setTerminalPresentationComplete] = useState(false);

  const presentedRoundsRef = useRef(new Set<string>());
  const acceptFinishedRound = useCallback((frame: OkeyMatchServerProjection) => {
    if (frame.phase !== "finished") return;
    // Settlement versions may change; presentation identity is the match and round.
    const key = JSON.stringify([matchId, frame.currentRound]);
    if (presentedRoundsRef.current.has(key)) return;
    presentedRoundsRef.current.add(key);
    setCompletedRoundFrame(frame);
    setEndRoundPresentationStage("draining");
  }, [matchId]);

  useEffect(() => {
    if (!adapter) return;
    return adapter.subscribeCommittedTransitions((frame) => {
      acceptFinishedRound(frame.projection);
    });
  }, [adapter, acceptFinishedRound]);

  useEffect(() => {
    if (!projection || projection.phase !== "finished" || completedRoundFrame) return;
    acceptFinishedRound(projection);
  }, [acceptFinishedRound, completedRoundFrame, projection]);

  const beginFinalTilePresentation = useCallback(() => {
    setEndRoundPresentationStage((stage) => {
      if (stage !== "draining") return stage;
      const isCycleLimit =
        completedRoundFrame?.endReason === "tile-cycle-limit" ||
        projection?.endReason === "tile-cycle-limit";
      return isCycleLimit ? "cycle-limit" : "final-tile";
    });
  }, [completedRoundFrame?.endReason, projection?.endReason]);

  const completeFinalPresentation = useCallback(() => {
    setEndRoundPresentationStage((stage) => stage === "final-tile" ? "score" : stage);
    if (projection?.matchFinished || completedRoundFrame?.matchFinished) {
      setTerminalPresentationComplete(true);
    }
  }, [projection?.matchFinished, completedRoundFrame?.matchFinished]);

  useEffect(() => {
    if (endRoundPresentationStage !== "cycle-limit" || !completedRoundFrame) return;
    const timer = setTimeout(() => {
      setCompletedRoundFrame(null);
      if (completedRoundFrame.matchFinished) setTerminalPresentationComplete(true);
      setEndRoundPresentationStage(completedRoundFrame.matchFinished ? "complete" : "idle");
    }, OKEY_TILE_CYCLE_ANNOUNCEMENT_MS);
    return () => clearTimeout(timer);
  }, [completedRoundFrame, endRoundPresentationStage]);

  useEffect(() => {
    if (endRoundPresentationStage !== "score" || !completedRoundFrame) return;
    const timer = setTimeout(() => {
      if (completedRoundFrame.matchFinished) setTerminalPresentationComplete(true);
      setCompletedRoundFrame(null);
      setEndRoundPresentationStage(completedRoundFrame.matchFinished ? "complete" : "idle");
    }, OKEY_SCORE_PRESENTATION_MS);
    return () => clearTimeout(timer);
  }, [completedRoundFrame, endRoundPresentationStage]);

  useEffect(() => {
    if (!projection?.matchFinished || terminalPresentationComplete) return;
    const timer = setTimeout(() => {
      setTerminalPresentationComplete(true);
    }, 6_500);
    return () => clearTimeout(timer);
  }, [projection?.matchFinished, terminalPresentationComplete]);

  const presentedProjection = completedRoundFrame ?? projection;
  const fallback = useMemo(() => createInitialOkeyGame(), []);
  const state = useMemo(
    () => presentedProjection ? projectOkeyServerState(presentedProjection, currentUserId) : fallback,
    [currentUserId, fallback, presentedProjection],
  );

  const dispatch = useCallback(async (command: OkeyAuthoritativeCommand) => {
    if (!adapter) return false;
    try {
      await adapter.dispatch(command);
      return true;
    } catch {
      return false;
    }
  }, [adapter]);

  const draw = useCallback((source: OkeyDrawSource) => dispatch({ type: "draw", source }), [dispatch]);
  const discard = useCallback((tileId: string) => dispatch({ type: "discard", tileId }), [dispatch]);
  const commitOpenIntent = useCallback((melds: OkeyMeld[], score: number, tileId?: string) => dispatch(tileId
    ? { type: "open-and-discard", melds, score, tileId } : { type: "open-melds", melds, score }), [dispatch]);
  const declareKonkan = useCallback(
    (
      orderedRunTileIds: string[],
      completionMeldTileIds: string[],
      discardTileId: string,
    ) =>
      dispatch({
        type: "declare-konkan",
        orderedRunTileIds,
        completionMeldTileIds,
        discardTileId,
      }),
    [dispatch],
  );
  const spendTileOnTableMeld = useCallback((tileId: string, targetPlayerId: string, targetMeldId: string, runEnd?: "start" | "end") =>
    dispatch({ type: "spend-meld", tileId, targetPlayerId, targetMeldId, ...(runEnd ? { runEnd } : {}) }), [dispatch]);
  const lockKonkanSetOnTable = useCallback((tileId: string, targetPlayerId: string, targetMeldId: string, runEnd?: "start" | "end") =>
    dispatch({ type: "lock-konkan", tileId, targetPlayerId, targetMeldId, ...(runEnd ? { runEnd } : {}) }), [dispatch]);

  const roundResults = useMemo(() => presentedProjection ? projectResults(presentedProjection) : [], [presentedProjection]);
  const currentRound = presentedProjection?.currentRound ?? 1;
  const matchFinished = presentedProjection?.matchFinished ?? false;
  const showRoundResultPopup = endRoundPresentationStage === "score";
  const isFinalComplete = endRoundPresentationStage === "score" || terminalPresentationComplete;
  const showMatchResultPopup = matchFinished && isFinalComplete;
  const currentRoundResult = showRoundResultPopup || matchFinished
    ? roundResults.at(-1) ?? null : roundResults.find((result) => result.round === currentRound) ?? null;

  return {
    state, onlineProjection: presentedProjection, authoritativeProjection: projection, onlineAdapter: adapter,
    leaveOnlineMatch: confirmExit, requestExit, cancelExit,
    exitConfirmationVisible, leaving,
    isAppActive, lifecycleResumeToken: resumeCount,
    currentRound, maxRounds: presentedProjection?.maxRounds ?? OKEY_RULESET_V1.match.roundCount,
    roundResults, matchScores: presentedProjection?.matchScores ?? { teamA: 0, teamB: 0 },
    showRoundResultPopup,
    currentRoundResult, matchFinished, matchWinnerTeamId: presentedProjection?.matchWinnerTeamId ?? null,
    showMatchResultPopup,
    finalPresentationComplete: isFinalComplete,
    endRoundPresentationStage, beginFinalTilePresentation, completeFinalPresentation,
    draw, discard, commitOpenIntent, declareKonkan, spendTileOnTableMeld, lockKonkanSetOnTable,
    turnTimeLeft: turnMillisecondsLeft === null ? 0 : Math.ceil(turnMillisecondsLeft / 1_000),
    turnTimeLeftMilliseconds: turnMillisecondsLeft ?? 0,
    serverClockOffsetMs: adapter?.getServerClockOffsetMs() ?? 0,
  };
}


