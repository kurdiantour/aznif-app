import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { localOkeyMatchAdapter } from "@/okey/adapters/local-okey-match-adapter";
import { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";
import { type OkeyRoomSnapshot } from "@/okey/multiplayer/okey-room-api";
import type { OkeyServerProjection } from "@/okey/server/okey-authoritative";

import { chooseBotDrawSource, prepareBotTurn } from "@/okey/engine/okey-bot-engine";
import { getOkeyBotDifficulty, getOkeyBotProfile, isOkeyBotControlled } from "@/okey/engine/okey-bot-policy";
import {
    canSpendTileOnBestMeld,
    createInitialOkeyGame,
    discardTile,
    getNextRoundDealerIndex,
    spendTileOnBestMeld,
} from "@/okey/engine/okey-engine";
import { prepareTimeoutTurn, resolveTimeoutTurn } from "@/okey/engine/okey-timeout";
import { reconcileOkeyMatchAfterInterruption } from "@/okey/lifecycle/okey-match-lifecycle";
import {
    MAX_ROUNDS,
    ROUND_RESULT_COUNTDOWN_SECONDS,
    createInitialOkeyMatch,
    settleFinishedRound,
    type OkeyMatchState,
} from "@/okey/match/okey-match-state";
import {
    clearLocalOkeyMatch,
    loadLocalOkeyMatchSnapshot,
    saveLocalOkeyMatch,
} from "@/okey/persistence/okey-local-match-storage";
import type {
    OkeyDrawSource,
    OkeyGameState,
    OkeyMeld,
    OkeyTile,
} from "@/okey/types/okey";

const FINISH_REVEAL_SECONDS = 5.35;

function createPlaceholderOkeyTile(id: string): OkeyTile {
  return { id, color: "black", value: 0, copy: 1 };
}

function createPlaceholderHand(playerId: string, count: number): OkeyTile[] {
  return Array.from({ length: count }, (_, index) => createPlaceholderOkeyTile(`hidden-${playerId}-${index}`));
}

function createPlaceholderDeck(count: number): OkeyTile[] {
  return Array.from({ length: count }, (_, index) => createPlaceholderOkeyTile(`deck-placeholder-${index}`));
}

function projectToOkeyGameState(projection: OkeyServerProjection): OkeyGameState {
  const totalPlayers = projection.players.length;
  const viewerIndex = projection.players.findIndex((player) => Array.isArray(player.hand));
  const normalizedPlayers = projection.players.map((player) => {
    const hand = Array.isArray(player.hand)
      ? player.hand
      : createPlaceholderHand(player.id, player.handCount);

    return {
      id: player.id,
      name: player.name,
      kind: "human" as const,
      botDifficulty: player.botDifficulty,
      controlledByBot: player.controlledByBot,
      teamId: player.teamId,
      hand,
      opened: player.opened,
      melds: player.melds,
      scoreOpened: player.scoreOpened,
      konkan: player.konkan,
      konkanEntryReason: player.konkanEntryReason,
      pendingKonkanFromDiscard: player.pendingKonkanFromDiscard ?? false,
      eliminated: player.eliminated,
    };
  });

  const reorderedPlayers = viewerIndex > 0
    ? [...normalizedPlayers.slice(viewerIndex), ...normalizedPlayers.slice(0, viewerIndex)]
    : normalizedPlayers;

  const normalizeIndex = (index: number) => {
    if (viewerIndex < 0) return index;
    return (index - viewerIndex + totalPlayers) % totalPlayers;
  };

  return {
    players: reorderedPlayers,
    stagingMelds: projection.stagingMelds,
    teamFirstOpenScores: projection.teamFirstOpenScores,
    currentPlayerIndex: normalizeIndex(projection.currentPlayerIndex),
    dealerIndex: normalizeIndex(projection.dealerIndex),
    deck: createPlaceholderDeck(projection.deckCount),
    discardPile: projection.discardPile,
    discardOwners: projection.discardOwners,
    konkanDiscardPickCounts: projection.konkanDiscardPickCounts,
    mustFinishAfterSecondKonkanDiscardPickPlayerId: projection.mustFinishAfterSecondKonkanDiscardPickPlayerId,
    reshuffleCount: projection.reshuffleCount,
    indicatorTile: projection.indicatorTile,
    okeyTile: projection.okeyTile,
    phase: projection.phase,
    winnerId: projection.winnerId,
    endReason: projection.endReason,
    turnMessage: projection.turnMessage,
    hasDrawnThisTurn: projection.hasDrawnThisTurn,
  };
}

export function useOkeyGame(onlineTableId?: string, onlineMatchId?: string) {
  const [match, setMatch] = useState<OkeyMatchState>(() => createInitialOkeyMatch());
  const [room, setRoom] = useState<OkeyRoomSnapshot | null>(null);
  const [onlineProjection, setOnlineProjection] = useState<OkeyServerProjection | null>(null);
  const [onlineAdapter, setOnlineAdapter] = useState<SupabaseOkeyMatchAdapter | null>(null);

  const [hasLoadedSavedGame, setHasLoadedSavedGame] = useState(false);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === "active");
  const [lifecycleResumeToken, setLifecycleResumeToken] = useState(0);
  const matchRef = useRef(match);

  const inactiveAtRef = useRef<number | null>(null);
  const appStateRef = useRef(AppState.currentState);

  const [pendingBotDraw, setPendingBotDraw] = useState<{
    playerId: string;
    tile: OkeyTile;
    source: OkeyDrawSource;
  } | null>(null);

  const [pendingBotDiscardTileId, setPendingBotDiscardTileId] = useState<string | null>(null);
  const [pendingTimeoutDiscardTileId, setPendingTimeoutDiscardTileId] = useState<string | null>(null);

  const state = match.roundState;

  useEffect(() => {
    let mounted = true;
    loadLocalOkeyMatchSnapshot()
      .then((snapshot) => {
        if (!mounted) return;
        if (snapshot) {
          const settled = settleFinishedRound(snapshot.match);
          setMatch(reconcileOkeyMatchAfterInterruption(settled, Date.now() - snapshot.savedAt).match);
        }
      })
      .catch((error) => console.warn("Unable to load saved Okey match", error))
      .finally(() => {
        if (mounted) setHasLoadedSavedGame(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (previousState === "active" && nextState !== "active") {
        const suspendedAt = Date.now();
        inactiveAtRef.current = suspendedAt;
        setIsAppActive(false);
        setPendingBotDraw(null);
        setPendingBotDiscardTileId(null);
        setPendingTimeoutDiscardTileId(null);
        saveLocalOkeyMatch(matchRef.current, suspendedAt).catch((error) => console.warn("Unable to save suspended Okey match", error));
      } else if (previousState !== "active" && nextState === "active") {
        const resumedAt = Date.now();
        const elapsedMs = inactiveAtRef.current === null ? 0 : resumedAt - inactiveAtRef.current;
        inactiveAtRef.current = null;
        setMatch((current) => reconcileOkeyMatchAfterInterruption(current, elapsedMs).match);
        setIsAppActive(true);
        setLifecycleResumeToken((token) => token + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  const saveMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hasLoadedSavedGame) return;

    if (saveMatchTimerRef.current) {
      clearTimeout(saveMatchTimerRef.current);
    }

    saveMatchTimerRef.current = setTimeout(() => {
      saveLocalOkeyMatch(matchRef.current).catch((error) => console.warn("Unable to save Okey match", error));
      saveMatchTimerRef.current = null;
    }, 300);

    return () => {
      if (saveMatchTimerRef.current) {
        clearTimeout(saveMatchTimerRef.current);
        saveMatchTimerRef.current = null;
      }
    };
  }, [hasLoadedSavedGame, match]);

  useEffect(() => () => {
    if (saveMatchTimerRef.current) {
      clearTimeout(saveMatchTimerRef.current);
      saveMatchTimerRef.current = null;
    }
  }, []);

  const updateRoundState = useCallback((updater: (current: OkeyGameState) => OkeyGameState) => {
    setMatch((current) => {
      if (current.matchFinished) return current;
      return settleFinishedRound({ ...current, roundState: updater(current.roundState) });
    });
  }, []);

  const newGame = useCallback(() => {
    clearLocalOkeyMatch().catch((error) => console.warn("Unable to clear saved Okey match", error));
    setMatch(createInitialOkeyMatch());
  }, []);

  const nextRound = useCallback(() => {
    setMatch((current) => {
      if (!current.showRoundResultPopup) return current;
      if (current.roundState.endReason === "tile-cycle-limit") {
        return {
          ...current,
          roundState: createInitialOkeyGame(current.roundState.dealerIndex),
          showRoundResultPopup: false,
          showFinishRevealPopup: false,
          roundResultCountdownRemaining: null,
        };
      }
      if (!current.roundResults.some((result) => result.round === current.currentRound)) return current;
      if (current.matchFinished || current.currentRound >= MAX_ROUNDS) return { ...current, showRoundResultPopup: true, roundResultCountdownRemaining: null, matchFinished: true };
      return {
        ...current,
        roundState: createInitialOkeyGame(getNextRoundDealerIndex(current.roundState)),
        currentRound: current.currentRound + 1,
        showRoundResultPopup: false,
        showFinishRevealPopup: false,
        roundResultCountdownRemaining: null,
      };
    });
  }, []);


  useEffect(() => {
    if (!hasLoadedSavedGame || !isAppActive) return;
    if (!match.showFinishRevealPopup) return;

    const timer = setTimeout(() => {
      setMatch((current) => {
        if (!current.showFinishRevealPopup) return current;
        return {
          ...current,
          showFinishRevealPopup: false,
          showRoundResultPopup: true,
          roundResultCountdownRemaining: ROUND_RESULT_COUNTDOWN_SECONDS,
        };
      });
    }, FINISH_REVEAL_SECONDS * 1000);

    return () => clearTimeout(timer);
  }, [hasLoadedSavedGame, isAppActive, match.showFinishRevealPopup]);


  useEffect(() => {
    if (!hasLoadedSavedGame || !isAppActive) return;
    if (!match.showRoundResultPopup) return;
    if (match.roundResultCountdownRemaining === null) return;

    if (match.roundResultCountdownRemaining <= 0) {
      if (match.matchFinished) {
        setMatch((current) => ({
          ...current,
          showRoundResultPopup: false,
          showFinishRevealPopup: false,
          roundResultCountdownRemaining: null,
          showMatchResultPopup: true,
        }));
        return;
      }
      nextRound();
      return;
    }

    const timer = setTimeout(() => {
      setMatch((current) => {
        if (!current.showRoundResultPopup || current.roundResultCountdownRemaining === null) return current;
        return {
          ...current,
          roundResultCountdownRemaining: Math.max(0, current.roundResultCountdownRemaining - 1),
        };
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [hasLoadedSavedGame, isAppActive, match.matchFinished, match.roundResultCountdownRemaining, match.showRoundResultPopup, newGame, nextRound]);
  const draw = useCallback((source: OkeyDrawSource) => updateRoundState((current) => localOkeyMatchAdapter.apply(current, { type: "draw", source })), [updateRoundState]);
  const discard = useCallback((tileId: string) => updateRoundState((current) => localOkeyMatchAdapter.apply(current, { type: "discard", tileId })), [updateRoundState]);
  const sortHand = useCallback(() => updateRoundState((current) => localOkeyMatchAdapter.apply(current, { type: "sort-hand", playerIndex: 0 })), [updateRoundState]);
  const moveTile = useCallback((tileId: string, targetIndex: number) => updateRoundState((current) => localOkeyMatchAdapter.apply(current, { type: "move-tile", playerIndex: 0, tileId, targetIndex })), [updateRoundState]);
  const moveTiles = useCallback((tileIds: string[], targetIndex: number) => updateRoundState((current) => localOkeyMatchAdapter.apply(current, { type: "move-tiles", playerIndex: 0, tileIds, targetIndex })), [updateRoundState]);
  const openMelds = useCallback((melds: OkeyMeld[], score: number) => updateRoundState((current) => localOkeyMatchAdapter.apply(current, { type: "open-melds", playerIndex: 0, melds, score })), [updateRoundState]);
  const declareKonkan = useCallback(() => updateRoundState((current) => localOkeyMatchAdapter.apply(current, { type: "declare-konkan", playerIndex: 0 })), [updateRoundState]);
  const spendTile = useCallback((tileId: string) => updateRoundState((current) => localOkeyMatchAdapter.apply(current, { type: "spend-best", playerIndex: 0, tileId })), [updateRoundState]);
  const spendTileOnTableMeld = useCallback((tileId: string, targetPlayerId: string, targetMeldId: string) => updateRoundState((current) => localOkeyMatchAdapter.apply(current, { type: "spend-meld", playerIndex: 0, tileId, targetPlayerId, targetMeldId })), [updateRoundState]);
  const lockKonkanSetOnTable = useCallback((tileId: string, targetPlayerId: string, targetMeldId: string) => updateRoundState((current) => localOkeyMatchAdapter.apply(current, { type: "lock-konkan", playerIndex: 0, tileId, targetPlayerId, targetMeldId })), [updateRoundState]);
  const spendOrDiscardTile = useCallback((tileId: string) => updateRoundState((current) => canSpendTileOnBestMeld(current, 0, tileId) ? spendTileOnBestMeld(current, 0, tileId) : current.hasDrawnThisTurn ? discardTile(current, tileId) : current), [updateRoundState]);
  const beginTimeoutHumanTurn = useCallback(() => {
    let preparedTileId: string | null = null;
    updateRoundState((current) => {
      if (current.phase !== "playing" || current.currentPlayerIndex !== 0) return current;
      if (current.hasDrawnThisTurn) return resolveTimeoutTurn(current, 0);

      const prepared = prepareTimeoutTurn(current, 0);
      preparedTileId = prepared.drawnTileId;
      setPendingTimeoutDiscardTileId(prepared.drawnTileId);
      return prepared.state;
    });
    return preparedTileId;
  }, [updateRoundState]);

  const playEliminated = useCallback(() => updateRoundState((current) => localOkeyMatchAdapter.apply(current, { type: "play-eliminated" })), [updateRoundState]);

  const commitPendingTimeoutDiscard = useCallback(() => {
    const tileId = pendingTimeoutDiscardTileId;
    if (!tileId) return;
    setPendingTimeoutDiscardTileId(null);
    updateRoundState((current) => discardTile(current, tileId));
  }, [pendingTimeoutDiscardTileId, updateRoundState]);

  useEffect(() => {
    if (!hasLoadedSavedGame || !isAppActive) return;
    if (match.matchFinished || state.phase !== "playing") return;
    if (pendingBotDraw || pendingBotDiscardTileId) return;
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.eliminated) return;
    if (!isOkeyBotControlled(currentPlayer)) return;
    const botDifficulty = getOkeyBotDifficulty(currentPlayer);
    const timer = setTimeout(() => {
      updateRoundState((current) => {
        const player = current.players[current.currentPlayerIndex];
        if (!isOkeyBotControlled(player)) return current;
        const currentDifficulty = getOkeyBotDifficulty(player);
        const drawSource = current.hasDrawnThisTurn ? null : chooseBotDrawSource(current, { difficulty: currentDifficulty });
        const drawnTile = drawSource === "deck"
          ? current.deck[0] ?? null
          : drawSource === "discard"
            ? current.discardPile[current.discardPile.length - 1] ?? null
            : null;
        const prepared = prepareBotTurn(current, { difficulty: currentDifficulty });
        if (player && drawSource && drawnTile) {
          setPendingBotDraw({ playerId: player.id, tile: drawnTile, source: drawSource });
        }
        setPendingBotDiscardTileId(prepared.discardTileId);
        return prepared.state;
      });
    }, getOkeyBotProfile(botDifficulty).thinkDelayMs);
    return () => clearTimeout(timer);
  }, [hasLoadedSavedGame, isAppActive, match.matchFinished, pendingBotDraw, pendingBotDiscardTileId, state.currentPlayerIndex, state.phase, state.players, updateRoundState]);

  const currentRoundResult = useMemo(
    () => match.roundResults.find((result) => result.round === match.currentRound) ?? null,
    [match.currentRound, match.roundResults],
  );

  return {
    state,
    isAppActive,
    lifecycleResumeToken,
    currentRound: match.currentRound,
    maxRounds: MAX_ROUNDS,
    roundResults: match.roundResults,
    matchScores: match.matchScores,
    showRoundResultPopup: match.showRoundResultPopup,
    showFinishRevealPopup: match.showFinishRevealPopup,
    currentRoundResult,
    matchFinished: match.matchFinished,
    matchWinnerTeamId: match.matchWinnerTeamId,
    showMatchResultPopup: match.showMatchResultPopup,
    roundResultCountdownRemaining: match.roundResultCountdownRemaining,
    resetGame: newGame,
    newGame,
    nextRound,
    draw,
    discard,
    sortHand,
    moveTile,
    moveTiles,
    openMelds,
    declareKonkan,
    spendTile,
    spendTileOnTableMeld,
    lockKonkanSetOnTable,
    playEliminated,
    spendOrDiscardTile,
    pendingTimeoutDiscardTileId,
    beginTimeoutHumanTurn,
    commitPendingTimeoutDiscard,
    pendingBotDraw,
    clearPendingBotDraw: () => setPendingBotDraw(null),
    pendingBotDiscardTileId,
    clearPendingBotDiscardTileId: () => setPendingBotDiscardTileId(null),
  };
}









