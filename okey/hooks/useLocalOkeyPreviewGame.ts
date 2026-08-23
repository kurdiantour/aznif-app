import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { OkeyGameController } from "@/okey/controllers/okey-game-controller";

import {
  declareKonkanOpen,
  createInitialOkeyGame,
  discardTile,
  drawTile,
  lockKonkanSet,
  movePlayerHandTile,
  movePlayerHandTiles,
  openPlayerMelds,
  playEliminatedTurn,
  spendTileOnMeld,
  getNextRoundDealerIndex,
} from "@/okey/engine/okey-engine";

import { playBotTurn } from "@/okey/engine/okey-bot-engine";

import {
  handSeatToBot,
  isOkeyBotControlled,
} from "@/okey/engine/okey-bot-policy";

import {
  createInitialOkeyMatch,
  MAX_ROUNDS,
  settleFinishedRound,
  type OkeyMatchState,
} from "@/okey/match/okey-match-state";


const FINISH_REVEAL_MS = 5350;


function createLocalPreviewRound(
  dealerIndex?: number,
): OkeyMatchState["roundState"] {
  let state = createInitialOkeyGame(dealerIndex);

  for (
    let playerIndex = 1;
    playerIndex < state.players.length;
    playerIndex += 1
  ) {
    state = handSeatToBot(
      state,
      playerIndex,
      "normal",
    );
  }

  return state;
}


function createLocalPreviewMatch(): OkeyMatchState {
  const match = createInitialOkeyMatch();

  return {
    ...match,
    roundState: createLocalPreviewRound(
      match.roundState.dealerIndex,
    ),
  };
}


export function getNextLocalPreviewDealerIndex(
  state: OkeyMatchState["roundState"],
) {
  return state.endReason === "tile-cycle-limit"
    ? state.dealerIndex
    : getNextRoundDealerIndex(state);
}


export function canCommitLocalPreviewBotTurn(
  state: OkeyMatchState["roundState"],
  expectedPlayerId: string,
  presentationBlocked: boolean,
): boolean {
  const player = state.players[state.currentPlayerIndex];
  return (
    !presentationBlocked &&
    state.phase === "playing" &&
    player?.id === expectedPlayerId &&
    isOkeyBotControlled(player)
  );
}
export function useLocalOkeyPreviewGame(): OkeyGameController {
  const [match, setMatch] =
    useState<OkeyMatchState>(() =>
      createLocalPreviewMatch(),
    );
  const pendingTimeoutDiscardTileId: string | null = null;

  const [turnPresentationBlocked, setTurnPresentationBlocked] =
    useState(false);
  const turnPresentationBlockedRef = useRef(turnPresentationBlocked);
  turnPresentationBlockedRef.current = turnPresentationBlocked;


  const updateRound = useCallback(
    (
      update: (
        state: OkeyMatchState["roundState"],
      ) => OkeyMatchState["roundState"],
    ) => {
      setMatch((current) =>
        settleFinishedRound({
          ...current,
          roundState: update(
            current.roundState,
          ),
        }),
      );
    },
    [],
  );


  // --------------------------------------------------
  // BOT TURN
  // --------------------------------------------------

useEffect(() => {
  const player =
    match.roundState.players[
      match.roundState.currentPlayerIndex
    ];
  const expectedPlayerId = player?.id ?? "";

  if (!canCommitLocalPreviewBotTurn(
    match.roundState,
    expectedPlayerId,
    turnPresentationBlocked,
  )) {
    return;
  }

  const timer = setTimeout(() => {
    updateRound((state) =>
      canCommitLocalPreviewBotTurn(
        state,
        expectedPlayerId,
        turnPresentationBlockedRef.current,
      )
        ? playBotTurn(state)
        : state,
    );
  }, 0);

  return () => clearTimeout(timer);
}, [
  turnPresentationBlocked,
  match.roundState.currentPlayerIndex,
  match.roundState.phase,
  updateRound,
]);
  // --------------------------------------------------
  // FINISH REVEAL POPUP
  // --------------------------------------------------

  useEffect(() => {
    if (!match.showFinishRevealPopup) {
      return;
    }

    const timer = setTimeout(() => {
      setMatch((current) =>
        current.showFinishRevealPopup
          ? {
              ...current,
              showFinishRevealPopup:
                false,
              showRoundResultPopup: true,
              roundResultCountdownRemaining:
                5,
            }
          : current,
      );
    }, FINISH_REVEAL_MS);

    return () => clearTimeout(timer);
  }, [match.showFinishRevealPopup]);


  // --------------------------------------------------
  // ROUND RESULT COUNTDOWN
  // --------------------------------------------------

  useEffect(() => {
    if (
      !match.showRoundResultPopup ||
      match.roundResultCountdownRemaining ===
        null
    ) {
      return;
    }

    const timer = setTimeout(() => {
      setMatch((current) => {
        if (
          !current.showRoundResultPopup ||
          current.roundResultCountdownRemaining ===
            null
        ) {
          return current;
        }

        if (
          current.roundResultCountdownRemaining >
          0
        ) {
          return {
            ...current,
            roundResultCountdownRemaining:
              current.roundResultCountdownRemaining -
              1,
          };
        }

        if (current.matchFinished) {
          return {
            ...current,
            showRoundResultPopup: false,
            showMatchResultPopup: true,
            roundResultCountdownRemaining:
              null,
          };
        }

        return {
          ...current,

          roundState:
            createLocalPreviewRound(
              getNextLocalPreviewDealerIndex(
                current.roundState,
              ),
            ),

          currentRound:
            current.currentRound + 1,

          showRoundResultPopup: false,

          roundResultCountdownRemaining:
            null,
        };
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    match.roundResultCountdownRemaining,
    match.showRoundResultPopup,
  ]);


  // --------------------------------------------------
  // BASIC GAME ACTIONS
  // --------------------------------------------------

  const draw =
    useCallback<OkeyGameController["draw"]>(
      (source) =>
        updateRound((state) =>
          drawTile(state, source),
        ),
      [updateRound],
    );


  const discard =
    useCallback<
      OkeyGameController["discard"]
    >(
      (tileId) =>
        updateRound((state) =>
          discardTile(state, tileId),
        ),
      [updateRound],
    );


  const moveTile =
    useCallback<
      OkeyGameController["moveTile"]
    >(
      (tileId, targetIndex) =>
        updateRound((state) =>
          movePlayerHandTile(
            state,
            0,
            tileId,
            targetIndex,
          ),
        ),
      [updateRound],
    );


  const moveTiles =
    useCallback<
      OkeyGameController["moveTiles"]
    >(
      (tileIds, targetIndex) =>
        updateRound((state) =>
          movePlayerHandTiles(
            state,
            0,
            tileIds,
            targetIndex,
          ),
        ),
      [updateRound],
    );


  const openMelds =
    useCallback<
      OkeyGameController["openMelds"]
    >(
      (melds, score) =>
        updateRound((state) =>
          openPlayerMelds(
            state,
            0,
            melds,
            score,
          ),
        ),
      [updateRound],
    );


  const declareKonkan =
    useCallback<
      OkeyGameController["declareKonkan"]
    >(
      (orderedRunTileIds) =>
        updateRound((state) =>
          declareKonkanOpen(
            state,
            0,
            orderedRunTileIds,
          ),
        ),
      [updateRound],
    );


  const spendTileOnTableMeld =
    useCallback<
      OkeyGameController["spendTileOnTableMeld"]
    >(
      (
        tileId,
        ownerPlayerId,
        meldId,
      ) =>
        updateRound((state) =>
          spendTileOnMeld(
            state,
            0,
            tileId,
            ownerPlayerId,
            meldId,
          ),
        ),
      [updateRound],
    );


  const lockKonkanSetOnTable =
    useCallback<
      OkeyGameController["lockKonkanSetOnTable"]
    >(
      (
        tileId,
        ownerPlayerId,
        meldId,
      ) =>
        updateRound((state) =>
          lockKonkanSet(
            state,
            0,
            tileId,
            ownerPlayerId,
            meldId,
          ),
        ),
      [updateRound],
    );


  const playEliminated =
    useCallback(() => {
      updateRound((state) =>
        playEliminatedTurn(state),
      );
    }, [updateRound]);


  // --------------------------------------------------
  // HUMAN TURN TIMEOUT
  // --------------------------------------------------
  // Preview never makes decisions for Player 0.
  // Player 0 is controlled only by the user's input.

  const beginTimeoutHumanTurn = useCallback(() => {
    return null;
  }, []);

  const commitPendingTimeoutDiscard = useCallback(() => {
    // Intentionally disabled in Preview.
  }, []);


  // --------------------------------------------------
  // NEW GAME
  // --------------------------------------------------

  const newGame =
    useCallback(() => {
      setMatch(
        createLocalPreviewMatch(),
      );
    }, []);


  const noop =
    useCallback(() => undefined, []);

  const noopAsync =
    useCallback(
      async () => undefined,
      [],
    );


  // --------------------------------------------------
  // CURRENT ROUND RESULT
  // --------------------------------------------------

  const currentRoundResult =
    useMemo(() => {
      if (
        match.showFinishRevealPopup ||
        match.showRoundResultPopup ||
        match.matchFinished
      ) {
        return (
          match.roundResults[
            match.roundResults.length - 1
          ] ?? null
        );
      }

      return (
        match.roundResults.find(
          (result) =>
            result.round ===
            match.currentRound,
        ) ?? null
      );
    }, [
      match.currentRound,
      match.matchFinished,
      match.roundResults,
      match.showFinishRevealPopup,
      match.showRoundResultPopup,
    ]);


  // --------------------------------------------------
  // CONTROLLER
  // --------------------------------------------------

  return {
    state: match.roundState,

    isOnline: false,

    onlineTableId: null,
    onlineMatchId: null,

    onlineReady: true,
    onlineError: null,

    onlineCommandPending: false,

    onlineProjection: null,
    onlineAdapter: null,

    reconnectOnline: noopAsync,
    leaveOnlineMatch: noopAsync,

    isAppActive: true,
    lifecycleResumeToken: 0,
    setTurnPresentationBlocked,

    currentRound:
      match.currentRound,

    maxRounds: MAX_ROUNDS,

    roundResults:
      match.roundResults,

    matchScores:
      match.matchScores,

    showRoundResultPopup:
      match.showRoundResultPopup,

    showFinishRevealPopup:
      match.showFinishRevealPopup,

    currentRoundResult,

    matchFinished:
      match.matchFinished,

    matchWinnerTeamId:
      match.matchWinnerTeamId,

    showMatchResultPopup:
      match.showMatchResultPopup,

    roundResultCountdownRemaining:
      match.roundResultCountdownRemaining,

    resetGame: newGame,
    newGame,

    nextRound: noop,

    draw,
    discard,

    sortHand: noop,

    moveTile,
    moveTiles,

    openMelds,
    declareKonkan,

    spendTile: noop,

    spendTileOnTableMeld,

    lockKonkanSetOnTable,

    playEliminated,

    spendOrDiscardTile: noop,

    // Human timeout intentionally disabled in Preview.
    pendingTimeoutDiscardTileId,

    beginTimeoutHumanTurn,

    commitPendingTimeoutDiscard,
  };
}
