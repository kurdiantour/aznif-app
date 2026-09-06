import { useCallback, useMemo } from "react";
import { useMultiplayerMatch } from "@/lib/multiplayer/match";
import { OkeyMultiplayerAdapter } from "@/okey/adapters/okey-multiplayer-adapter";
import { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";
import { buildOkeyCoreFinalResult, buildOkeyCoreRoundResult, selectOkeyMultiplayerLifecycle } from "@/okey/adapters/okey-multiplayer-projection";
import { createInitialOkeyGame, getRoundResultScoreDetails } from "@/okey/engine/okey-engine";
import { projectOkeyServerState } from "@/okey/presentation/okey-server-projection";
import { OKEY_RULESET_V1 } from "@/okey/rules/okey-ruleset-v1";
import type { OkeyAuthoritativeCommand, OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";
import type { OkeyDrawSource, OkeyGameState, OkeyMeld, OkeyTeamId } from "@/okey/types/okey";

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

export function useOkeyMultiplayerGame(matchId?: string, currentUserId: string | null = null) {
  const commands = useMemo(() => matchId ? new SupabaseOkeyMatchAdapter(matchId) : null, [matchId]);
  const adapter = useMemo(() => commands ? new OkeyMultiplayerAdapter(commands) : null, [commands]);
  const getServerNow = useCallback(() => commands
    ? new Date(Date.now() + commands.getServerClockOffsetMs()).toISOString() : null, [commands]);
  const core = useMultiplayerMatch({
    roomId: matchId, adapter, selectLifecycle: selectOkeyMultiplayerLifecycle,
    buildRoundResult: buildOkeyCoreRoundResult, buildFinalResult: buildOkeyCoreFinalResult,
    getSnapshotServerNow: getServerNow,
    roundSyncIntervalMs: 1_000,
  });
  const projection = core.snapshot;
  const refresh = core.refresh;
  const applySnapshot = core.applySnapshot;
  const fallback = useMemo(() => createInitialOkeyGame(), []);
  const state = useMemo(
    () => projection ? projectOkeyServerState(projection, currentUserId) : fallback,
    [currentUserId, fallback, projection],
  );

  const dispatch = useCallback(async (command: OkeyAuthoritativeCommand) => {
    if (!commands) return false;
    try {
      await commands.dispatch(command);
      const next = commands.getSnapshot();
      if (next) applySnapshot(next);
      return true;
    } catch {
      await refresh().catch(() => undefined);
      return false;
    }
  }, [commands, applySnapshot, refresh]);
  const draw = useCallback((source: OkeyDrawSource) => dispatch({ type: "draw", source }), [dispatch]);
  const discard = useCallback((tileId: string) => dispatch({ type: "discard", tileId }), [dispatch]);
  const commitOpenIntent = useCallback((melds: OkeyMeld[], score: number, tileId?: string) => dispatch(tileId
    ? { type: "open-and-discard", melds, score, tileId } : { type: "open-melds", melds, score }), [dispatch]);
  const declareKonkan = useCallback((orderedRunTileIds: string[]) => dispatch({ type: "declare-konkan", orderedRunTileIds }), [dispatch]);
  const spendTileOnTableMeld = useCallback((tileId: string, targetPlayerId: string, targetMeldId: string, runEnd?: "start" | "end") =>
    dispatch({ type: "spend-meld", tileId, targetPlayerId, targetMeldId, ...(runEnd ? { runEnd } : {}) }), [dispatch]);
  const lockKonkanSetOnTable = useCallback((tileId: string, targetPlayerId: string, targetMeldId: string, runEnd?: "start" | "end") =>
    dispatch({ type: "lock-konkan", tileId, targetPlayerId, targetMeldId, ...(runEnd ? { runEnd } : {}) }), [dispatch]);

  const roundResults = useMemo(() => projection ? projectResults(projection) : [], [projection]);
  const currentRound = projection?.currentRound ?? 1;
  const matchFinished = projection?.matchFinished ?? false;
  const showRoundResultPopup = core.showRoundResultPopup;
  const showMatchResultPopup = core.showFinalMatchPopup;
  const currentRoundResult = showRoundResultPopup || matchFinished
    ? roundResults.at(-1) ?? null : roundResults.find((result) => result.round === currentRound) ?? null;

  return {
    state, onlineProjection: projection, onlineAdapter: commands,
    leaveOnlineMatch: core.confirmExit, requestExit: core.requestExit, cancelExit: core.cancelExit,
    exitConfirmationVisible: core.exitConfirmationVisible, leaving: core.leaving,
    isAppActive: core.isAppActive, lifecycleResumeToken: core.resumeCount,
    currentRound, maxRounds: projection?.maxRounds ?? OKEY_RULESET_V1.match.roundCount,
    roundResults, matchScores: projection?.matchScores ?? { teamA: 0, teamB: 0 },
    showRoundResultPopup,
    currentRoundResult, matchFinished, matchWinnerTeamId: projection?.matchWinnerTeamId ?? null,
    showMatchResultPopup,
    finalPresentationComplete: core.finalPresentationComplete,
    completeFinalPresentation: core.completeFinalPresentation,
    draw, discard, commitOpenIntent, declareKonkan, spendTileOnTableMeld, lockKonkanSetOnTable,
    turnTimeLeft: core.turnSecondsLeft ?? 0,
    turnTimeLeftMilliseconds: core.turnMillisecondsLeft ?? 0,
    serverClockOffsetMs: commands?.getServerClockOffsetMs() ?? 0,
  };
}


