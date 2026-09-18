import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createInitialOkeyGame,
  discardTile,
  drawTile,
  lockKonkanSet,
  openPlayerMelds,
  spendTileOnMeld,
} from "@/okey/engine/okey-engine";
import { getOkeyBotProfile, isOkeyBotControlled, playBotTurn } from "@/okey/engine/okey-bot-engine";
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
    botDifficulty: "normal" as const,
    botNumber: index,
  }));
  return {
    ...initial,
    players,
  };
}

function createPreviewProjection(state: OkeyGameState, version: number): OkeyMatchServerProjection {
  return {
    ...state,
    version,
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
  const versionRef = useRef(0);

  const onlineProjection = useMemo(() => {
    versionRef.current += 1;
    return createPreviewProjection(state, versionRef.current);
  }, [state]);

  useEffect(() => {
    if (state.phase !== "playing") return;
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer || !isOkeyBotControlled(currentPlayer)) return;

    const botProfile = getOkeyBotProfile(currentPlayer.botDifficulty ?? "normal");
    const timeoutId = setTimeout(() => {
      setState((current) => {
        if (
          current.phase !== "playing" ||
          current.currentPlayerIndex !== state.currentPlayerIndex
        ) return current;
        return playBotTurn(current);
      });
    }, botProfile.thinkDelayMs);

    return () => clearTimeout(timeoutId);
  }, [state]);

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

  const [exitConfirmationVisible, setExitConfirmationVisible] = useState(false);

  const requestExit = useCallback(() => {
    setExitConfirmationVisible(true);
  }, []);

  const cancelExit = useCallback(() => {
    setExitConfirmationVisible(false);
  }, []);

  const leaveOnlineMatch = useCallback(() => {
    setExitConfirmationVisible(false);
    return Promise.resolve(true);
  }, []);

  const noop = useCallback(() => {}, []);

  return {
    state,
    onlineProjection,
    authoritativeProjection: onlineProjection,
    onlineAdapter: null,
    leaveOnlineMatch,
    requestExit,
    cancelExit,
    exitConfirmationVisible,
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
