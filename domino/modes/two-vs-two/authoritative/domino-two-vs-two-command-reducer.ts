import { roundToNearestFive } from '../../../core/engine/kozel-engine.ts';
import { resolveMatchOutcome } from '../../../core/rules/match-rules.ts';
import { getNextOkeyOrderPlayer } from '../../../core/rules/turn-order.ts';

export type TwoVsTwoPlayer = {
  user_id: string;
  team_id: 'teamA' | 'teamB';
  player_index: number;
};

export type TwoVsTwoTransition = {
  nextState: Record<string, any>;
  nextHands: any[][];
  nextBoneyard: any[];
  nextTurnPlayerId: string | null;
  status: 'active' | 'finished';
};

const pips = (hand: any[]) =>
  hand.reduce(
    (sum, tile) =>
      sum +
      Number(tile?.left ?? 0) +
      Number(tile?.right ?? 0),
    0,
  );

function opponentPips(
  hands: any[][],
  players: TwoVsTwoPlayer[],
  teamId: string,
) {
  return hands.reduce(
    (sum, hand, index) =>
      players[index]?.team_id === teamId
        ? sum
        : sum + pips(hand ?? []),
    0,
  );
}

export function reduceTwoVsTwoPlay(input: {
  state: Record<string, any>;
  hands: any[][];
  boneyard: any[];
  players: TwoVsTwoPlayer[];
  playerIndex: number;
  actorUserId: string;
  tile: any;
  branch?: string | null;
  nextBoard: any;
  nextSpinnerValue: number | null;
  moveScore: number;
  phaseStartedAt: string;
  isSameTile: (handTile: any, tile: any) => boolean;
  canAnyPlayerMove: (
    hands: any[][],
    board: any,
    spinner: number | null,
  ) => boolean;
}): TwoVsTwoTransition {
  if (
    input.players.length !== 4 ||
    input.hands.length !== 4
  ) {
    throw new Error(
      'domino_2v2_requires_exactly_four_players_and_hands',
    );
  }

  let removed = false;

  const nextHands = input.hands.map(
    (hand, index) =>
      index !== input.playerIndex
        ? hand
        : hand.filter((candidate) => {
            if (
              !removed &&
              input.isSameTile(
                candidate,
                input.tile,
              )
            ) {
              removed = true;
              return false;
            }

            return true;
          }),
  );

  if (!removed) {
    throw new Error(
      'domino_2v2_tile_not_found_in_hand',
    );
  }

  const currentPlayer =
    input.players[input.playerIndex];

  if (!currentPlayer) {
    throw new Error(
      'domino_2v2_invalid_player_mapping',
    );
  }

  const nextPlayerId =
    getNextOkeyOrderPlayer(
      input.players,
      currentPlayer,
    )?.user_id ?? null;

  const scores = {
    teamA: Number(
      input.state.teamScores?.teamA ?? 0,
    ),
    teamB: Number(
      input.state.teamScores?.teamB ?? 0,
    ),
  };

  let lastScoringEvent = null;
  let endOfHandScoringEvent = null;

  if (input.moveScore > 0) {
    scores[currentPlayer.team_id] +=
      input.moveScore;

    lastScoringEvent = {
      playerId: input.actorUserId,
      teamId: currentPlayer.team_id,
      points: input.moveScore,
      openEndsTotal: input.moveScore,
    };
  }

  let roundWinnerPlayerId:
    | string
    | null = null;

  let roundEndReason:
    | 'empty_hand'
    | 'blocked'
    | null = null;

  let leaderPlayerId =
    input.state.leaderPlayerId ??
    input.actorUserId;

  if (
    nextHands[input.playerIndex]
      ?.length === 0
  ) {
    roundWinnerPlayerId =
      input.actorUserId;
    roundEndReason = 'empty_hand';
    leaderPlayerId =
      input.actorUserId;

    const raw = opponentPips(
      nextHands,
      input.players,
      currentPlayer.team_id,
    );

    const points =
      roundToNearestFive(raw);

    if (points > 0) {
      scores[currentPlayer.team_id] +=
        points;

      endOfHandScoringEvent = {
        playerId: input.actorUserId,
        teamId:
          currentPlayer.team_id,
        points,
        openEndsTotal: raw,
      };
    }
  } else if (
    !input.canAnyPlayerMove(
      nextHands,
      input.nextBoard,
      input.nextSpinnerValue,
    )
  ) {
    const lowest =
      input.players.reduce(
        (best, _player, index) => {
          const total = pips(
            nextHands[index] ?? [],
          );

          return total < best.total
            ? { index, total }
            : best;
        },
        {
          index: 0,
          total: pips(
            nextHands[0] ?? [],
          ),
        },
      );

    const winner =
      input.players[lowest.index];

    roundWinnerPlayerId =
      winner.user_id;
    roundEndReason = 'blocked';

    // The player who made the final move
    // remains the source for choosing
    // the next hand's king.
    leaderPlayerId =
      input.actorUserId;

    const raw = opponentPips(
      nextHands,
      input.players,
      winner.team_id,
    );

    const points =
      roundToNearestFive(raw);

    if (points > 0) {
      scores[winner.team_id] +=
        points;

      endOfHandScoringEvent = {
        playerId: winner.user_id,
        teamId: winner.team_id,
        points,
        openEndsTotal: raw,
      };
    }
  }

  const finished =
    roundWinnerPlayerId
      ? resolveMatchOutcome(
          scores,
          input.state.matchReward ??
            null,
        )
      : {
          winningTeamId: null,
          matchReward: null,
        };

  const finalTurnPlayerId =
    roundWinnerPlayerId
      ? input.actorUserId
      : nextPlayerId;

  return {
    nextState: {
      ...input.state,
      mode: '2v2',
      board: input.nextBoard,
      spinnerValue:
        input.nextSpinnerValue,
      handCounts: nextHands.map(
        (hand) => hand.length,
      ),
      boneyardCount:
        input.boneyard.length,
      currentTurnPlayerId:
        finalTurnPlayerId,
      turnStartedAt:
        input.phaseStartedAt,
      roundStartsAt: null,
      isOpeningRound: false,
      isFirstRound: false,
      openingDouble: null,
      openingTileId: null,
      lastPlayedTile: input.tile,
      lastMoveBranch:
        input.branch ?? null,
      lastScoringEvent,
      endOfHandScoringEvent,
      teamScores: scores,
      roundWinnerPlayerId,
      roundEndReason,
      leaderPlayerId,
      winningTeamId:
        finished.winningTeamId,
      matchReward:
        finished.matchReward,
      lastPassedPlayerId: null,
      blockedPasses: [],
      canDrawTile: false,
    },
    nextHands,
    nextBoneyard:
      input.boneyard,
    nextTurnPlayerId:
      finalTurnPlayerId,
    status: finished.winningTeamId
      ? 'finished'
      : 'active',
  };
}

export function reduceTwoVsTwoPass(input: {
  state: Record<string, any>;
  hands: any[][];
  boneyard: any[];
  players: TwoVsTwoPlayer[];
  playerIndex: number;
  currentTurnPlayerId: string;
  timedOut: boolean;
  phaseStartedAt: string;
}): TwoVsTwoTransition {
  if (
    input.players.length !== 4 ||
    input.hands.length !== 4
  ) {
    throw new Error(
      'domino_2v2_requires_exactly_four_players_and_hands',
    );
  }

  const nextPlayerId =
    getNextOkeyOrderPlayer(
      input.players,
      input.players[
        input.playerIndex
      ],
    )?.user_id ?? null;

  const openingTimeoutWaived =
    input.timedOut &&
    !input.state.board?.centerTile &&
    (input.state.isOpeningRound ??
      input.state.isFirstRound ??
      true);

  const state =
    openingTimeoutWaived
      ? {
          ...input.state,
          isOpeningRound: false,
          isFirstRound: false,
          openingDouble: null,
          openingTileId: null,
        }
      : input.state;

  return {
    nextState: {
      ...state,
      roundWinnerPlayerId: null,
      roundEndReason: null,
      roundStartsAt: null,
      currentTurnPlayerId:
        nextPlayerId,
      lastPassedPlayerId:
        input.currentTurnPlayerId,
      turnStartedAt:
        input.phaseStartedAt,
      canDrawTile: false,
      blockedPasses: Array.from(
        new Set([
          ...(input.state
            .blockedPasses ?? []),
          input.currentTurnPlayerId,
        ]),
      ),
    },
    nextHands: input.hands,
    nextBoneyard:
      input.boneyard,
    nextTurnPlayerId:
      nextPlayerId,
    status: 'active',
  };
}

export function reduceTwoVsTwoStartNextHand(
  input: {
    state: Record<string, any>;
    hands: any[][];
    leaderPlayerId: string;
    phaseStartedAt: string;
    emptyBoard: any;
    completedRound?: Record<
      string,
      any
    >;
  },
): TwoVsTwoTransition {
  if (input.hands.length !== 4) {
    throw new Error(
      'domino_2v2_requires_exactly_four_hands',
    );
  }

  const nextState = {
    ...input.state,

    board: input.emptyBoard,
    spinnerValue: null,

    handCounts: input.hands.map(
      (hand) => hand.length,
    ),
    boneyardCount: 0,

    currentTurnPlayerId:
      input.leaderPlayerId,
    leaderPlayerId:
      input.leaderPlayerId,

    turnStartedAt:
      input.phaseStartedAt,
    roundStartsAt:
      input.phaseStartedAt,

    isOpeningRound: false,
    isFirstRound: false,
    openingDouble: null,
    openingTileId: null,

    // A new hand never inherits
    // gameplay-finished state.
    roundWinnerPlayerId: null,
    roundEndReason: null,

    lastPlayedTile: null,
    lastScoringEvent: null,
    endOfHandScoringEvent: null,
    lastPassedPlayerId: null,
    blockedPasses: [],
    canDrawTile: false,

    // Previous-hand information belongs
    // only to presentation/history.
    lastCompletedRound:
      input.completedRound ??
      input.state.lastCompletedRound ??
      null,
  };

  return {
    nextState,
    nextHands: input.hands,
    nextBoneyard: [],
    nextTurnPlayerId:
      input.leaderPlayerId,
    status: 'active',
  };
}

export function reduceTwoVsTwoBotPass(input: {
  state: Record<string, any>;
  hands: any[][];
  boneyard: any[];
  players: TwoVsTwoPlayer[];
  playerIndex: number;
  currentTurnPlayerId: string;
}): TwoVsTwoTransition {
  if (
    input.players.length !== 4 ||
    input.hands.length !== 4
  ) {
    throw new Error(
      'domino_2v2_requires_exactly_four_players_and_hands',
    );
  }

  const nextPlayerId =
    getNextOkeyOrderPlayer(
      input.players,
      input.players[
        input.playerIndex
      ],
    )?.user_id ?? null;

  return {
    nextState: {
      ...input.state,
      currentTurnPlayerId:
        nextPlayerId,
      lastPassedPlayerId:
        input.currentTurnPlayerId,
      blockedPasses: Array.from(
        new Set([
          ...(input.state
            .blockedPasses ?? []),
          input.currentTurnPlayerId,
        ]),
      ),
      canDrawTile: false,
    },
    nextHands: input.hands,
    nextBoneyard:
      input.boneyard,
    nextTurnPlayerId:
      nextPlayerId,
    status: 'active',
  };
}