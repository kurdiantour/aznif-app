import { useCallback, useMemo, useState } from "react";
import {
  createInitialOkeyGame,
  discardTile,
  drawTile,
  lockKonkanSet,
  openPlayerMelds,
  spendTileOnMeld,
} from "@/okey/engine/okey-engine";
import type { OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";
import type { OkeyDrawSource, OkeyGameState, OkeyMeld, OkeyTeamId } from "@/okey/types/okey";

function createPreviewState(): OkeyGameState {
  const initial = createInitialOkeyGame(0);
  const players = initial.players.map((player, index) => ({
    ...player,
    id: index === 0 ? "seat-0" : `seat-${index}`,
    name: index === 0 ? "You" : `Bot ${index}`,
    kind: index === 0 ? ("human" as const) : ("bot" as const),
    controlledByBot: index !== 0,
  }));
  return {
    ...initial,
    players,
  };
}

function createPreviewProjection(state: OkeyGameState): OkeyMatchServerProjection {
  return {
    ...state,
    version: 1,
    deckCount: state.deck.length,
    turnDeadlineAt: new Date(Date.now() + 30000).toISOString(),
    turnDurationSeconds: 30,
    currentRound: 1,
    maxRounds: 7,
    roundResults: [],
    matchScores: { teamA: 0, teamB: 0 },
    matchFinished: false,
    matchWinnerTeamId: null,
    nextRoundEligibleAt: null,
    forcedKonkanTeamId: null,
    roundStartsAt: null,
    lastTimeoutDiscardEvent: null,
    players: state.players.map((player) => ({
      ...player,
      handCount: player.hand.length,
      hand: player.hand,
    })),
  };
}

export function useOkeyPreviewGame() {
  const [state, setState] = useState<OkeyGameState>(createPreviewState);

  const onlineProjection = useMemo(
    () => createPreviewProjection(state),
    [state],
  );

  const draw = useCallback((source: OkeyDrawSource) => {
    setState((current) => drawTile(current, source));
    return Promise.resolve(true);
  }, []);

  const discard = useCallback((tileId: string) => {
    setState((current) => discardTile(current, tileId));
    return Promise.resolve(true);
  }, []);

  const commitOpenIntent = useCallback(
    (melds: OkeyMeld[], score: number, tileId?: string) => {
      setState((current) => {
        const opened = openPlayerMelds(current, 0, melds, score, {
          finalDiscard: Boolean(tileId),
        });
        return tileId && opened !== current ? discardTile(opened, tileId) : opened;
      });
      return Promise.resolve(true);
    },
    [],
  );

  const declareKonkan = useCallback(
    (
      _orderedRunTileIds: string[],
      _completionMeldTileIds: string[],
      discardTileId: string,
    ) => {
      setState((current) => discardTile(current, discardTileId));
      return Promise.resolve(true);
    },
    [],
  );

  const spendTileOnTableMeld = useCallback(
    (
      tileId: string,
      targetPlayerId: string,
      targetMeldId: string,
      runEnd?: "start" | "end",
    ) => {
      setState((current) =>
        spendTileOnMeld(current, 0, tileId, targetPlayerId, targetMeldId, runEnd),
      );
      return Promise.resolve(true);
    },
    [],
  );

  const lockKonkanSetOnTable = useCallback(
    (
      tileId: string,
      targetPlayerId: string,
      targetMeldId: string,
      runEnd?: "start" | "end",
    ) => {
      setState((current) =>
        lockKonkanSet(current, 0, tileId, targetPlayerId, targetMeldId, runEnd),
      );
      return Promise.resolve(true);
    },
    [],
  );

  const noop = useCallback(() => {}, []);

  return {
    state,
    onlineProjection,
    authoritativeProjection: onlineProjection,
    onlineAdapter: null,
    leaveOnlineMatch: noop,
    requestExit: noop,
    cancelExit: noop,
    exitConfirmationVisible: false,
    leaving: false,
    isAppActive: true,
    lifecycleResumeToken: 0,
    currentRound: 1,
    maxRounds: 7,
    roundResults: [],
    matchScores: { teamA: 0, teamB: 0 } as Record<OkeyTeamId, number>,
    showRoundResultPopup: false,
    currentRoundResult: null,
    matchFinished: false,
    matchWinnerTeamId: null,
    showMatchResultPopup: false,
    finalPresentationComplete: true,
    endRoundPresentationStage: "idle" as const,
    beginFinalTilePresentation: noop,
    completeFinalPresentation: noop,
    draw,
    discard,
    commitOpenIntent,
    declareKonkan,
    spendTileOnTableMeld,
    lockKonkanSetOnTable,
    turnTimeLeft: 30,
    turnTimeLeftMilliseconds: 30000,
    serverClockOffsetMs: 0,
  };
}
