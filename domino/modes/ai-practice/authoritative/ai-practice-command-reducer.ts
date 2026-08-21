import {
  applyMove,
  canAnyPlayerMove,
  canHandMove,
  isValidMove,
  roundToNearestFive,
} from '@/domino/core/engine/kozel-engine';
import { getAvailableBranches, handContainsTile } from '@/domino/shared/rules/game-rule-queries';
import {
  MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN,
  getBlockedRoundWinnerIndex1v1,
  pickPreferredBranch,
} from '@/domino/shared/game-shared';
import type { DominoTileData, KozelBranch } from '@/domino/types/domino-game';

export type AiPracticeAuthoritativeState = {
  seats: any[];
  currentIndex: number;
  leaderIndex: number;
  board: any;
  hands: DominoTileData[][];
  boneyard: DominoTileData[];
  spinnerValue: number | null;
  isOpeningRound: boolean;
  openingDouble: number | null;
  roundWinnerPlayerId: string | null;
  winningTeamId: string | null;
  teamScores: Record<string, number>;
  humanDrawsThisTurn: number;
  lastTilePlayerIndex: number | null;
};

export type AiPracticeTransition = {
  state: AiPracticeAuthoritativeState;
  lastPlayedTile?: DominoTileData | null;
  lastPassedPlayerId?: string | null;
  roundEndReason?: 'blocked' | 'empty_hand' | null;
  scoringEvents: Array<{
    playerId: string;
    teamId: string;
    points: number;
    openEndsTotal: number;
  }>;
  accepted: boolean;
};

function blockedTransition(
  state: AiPracticeAuthoritativeState,
  blockerIndex: number,
): AiPracticeTransition {
  const winnerIndex = getBlockedRoundWinnerIndex1v1(state.hands);
  const winner = state.seats[winnerIndex];
  const opponentPips = state.hands[(winnerIndex + 1) % 2].reduce(
    (sum, tile) => sum + tile.left + tile.right,
    0,
  );
  const points = roundToNearestFive(opponentPips);
  return {
    accepted: true,
    state: {
      ...state,
      leaderIndex: blockerIndex,
      roundWinnerPlayerId: winner.id,
      teamScores: {
        ...state.teamScores,
        [winner.teamId]: Number(state.teamScores[winner.teamId] ?? 0) + points,
      },
    },
    roundEndReason: 'blocked',
    scoringEvents: points > 0 ? [{
      playerId: winner.id,
      teamId: winner.teamId,
      points,
      openEndsTotal: opponentPips,
    }] : [],
  };
}

export function isAiPracticeRoundBlocked(state: AiPracticeAuthoritativeState) {
  if (!state.board.centerTile) return false;
  return !canAnyPlayerMove(
    state.hands,
    state.board,
    state.spinnerValue,
    state.isOpeningRound,
    state.openingDouble,
  ) && !canHandMove(
    state.boneyard,
    state.board,
    state.spinnerValue,
    state.isOpeningRound,
    state.openingDouble,
  );
}

export function reduceAiPracticePass(
  state: AiPracticeAuthoritativeState,
  playerIndex: number,
  force = false,
): AiPracticeTransition {
  const player = state.seats[playerIndex];
  if (
    !player ||
    state.roundWinnerPlayerId ||
    state.winningTeamId ||
    playerIndex !== state.currentIndex
  ) return { state, accepted: false, scoringEvents: [] };
  const playable = canHandMove(
    state.hands[playerIndex] ?? [],
    state.board,
    state.spinnerValue,
    state.isOpeningRound,
    state.openingDouble,
  );
  if (
    !force &&
    playerIndex === 0 &&
    state.board.centerTile &&
    state.boneyard.length > 0 &&
    !playable &&
    state.humanDrawsThisTurn < MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN
  ) return { state, accepted: false, scoringEvents: [] };
  return {
    accepted: true,
    state: {
      ...state,
      currentIndex: (playerIndex + 1) % state.seats.length,
      humanDrawsThisTurn: 0,
    },
    lastPassedPlayerId: player.id,
    scoringEvents: [],
  };
}

export function reduceAiPracticePlay(
  state: AiPracticeAuthoritativeState,
  tile: DominoTileData,
  playerIndex: number,
  preferredBranch?: KozelBranch,
): AiPracticeTransition {
  if (
    state.roundWinnerPlayerId ||
    state.winningTeamId ||
    playerIndex !== state.currentIndex ||
    !handContainsTile(state.hands[playerIndex] ?? [], tile.id)
  ) return { state, accepted: false, scoringEvents: [] };

  const context = {
    board: state.board,
    spinnerValue: state.spinnerValue,
    isOpeningRound: state.isOpeningRound,
    openingDouble: state.openingDouble,
  };
  const branches = getAvailableBranches(tile, context);
  if (!branches.length) return { state, accepted: false, scoringEvents: [] };
  const branch = preferredBranch && branches.includes(preferredBranch)
    ? preferredBranch
    : pickPreferredBranch(branches, ['right', 'left', 'up', 'down']);
  if (!isValidMove(
    tile,
    state.board,
    branch,
    state.spinnerValue,
    state.isOpeningRound,
    state.openingDouble,
  )) return { state, accepted: false, scoringEvents: [] };

  const move = applyMove(
    state.board,
    tile,
    branch,
    state.spinnerValue,
    state.isOpeningRound,
  );
  const hands = state.hands.map((hand, index) =>
    index === playerIndex ? hand.filter((candidate) => candidate.id !== tile.id) : hand,
  );
  const player = state.seats[playerIndex];
  const events: AiPracticeTransition['scoringEvents'] = [];
  const scores = { ...state.teamScores };
  if (move.moveScore > 0) {
    scores[player.teamId] = Number(scores[player.teamId] ?? 0) + move.moveScore;
    events.push({
      playerId: player.id,
      teamId: player.teamId,
      points: move.moveScore,
      openEndsTotal: move.moveScore,
    });
  }
  const next: AiPracticeAuthoritativeState = {
    ...state,
    board: move.board,
    hands,
    spinnerValue: move.spinnerValue,
    isOpeningRound: false,
    openingDouble: null,
    humanDrawsThisTurn: 0,
    lastTilePlayerIndex: playerIndex,
    teamScores: scores,
  };
  if (hands[playerIndex].length === 0) {
    const opponentPips = hands[(playerIndex + 1) % 2].reduce(
      (sum, candidate) => sum + candidate.left + candidate.right,
      0,
    );
    const points = roundToNearestFive(opponentPips);
    if (points > 0) {
      scores[player.teamId] += points;
      events.push({
        playerId: player.id,
        teamId: player.teamId,
        points,
        openEndsTotal: opponentPips,
      });
    }
    return {
      accepted: true,
      state: {
        ...next,
        teamScores: scores,
        roundWinnerPlayerId: player.id,
        leaderIndex: playerIndex,
      },
      lastPlayedTile: tile,
      lastPassedPlayerId: null,
      roundEndReason: 'empty_hand',
      scoringEvents: events,
    };
  }
  if (isAiPracticeRoundBlocked(next)) {
    const blocked = blockedTransition(next, playerIndex);
    return {
      ...blocked,
      lastPlayedTile: tile,
      lastPassedPlayerId: null,
      scoringEvents: [...events, ...blocked.scoringEvents],
    };
  }
  return {
    accepted: true,
    state: { ...next, currentIndex: (playerIndex + 1) % state.seats.length },
    lastPlayedTile: tile,
    lastPassedPlayerId: null,
    scoringEvents: events,
  };
}

export function reduceAiPracticeHumanDraw(
  state: AiPracticeAuthoritativeState,
  playerIndex: number,
): AiPracticeTransition {
  if (
    state.roundWinnerPlayerId ||
    state.winningTeamId ||
    playerIndex !== state.currentIndex ||
    !state.board.centerTile ||
    state.boneyard.length === 0 ||
    (playerIndex === 0 &&
      state.humanDrawsThisTurn >= MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN) ||
    canHandMove(
      state.hands[playerIndex] ?? [],
      state.board,
      state.spinnerValue,
      state.isOpeningRound,
      state.openingDouble,
    )
  ) return { state, accepted: false, scoringEvents: [] };
  if (isAiPracticeRoundBlocked(state)) {
    return blockedTransition(
      state,
      state.lastTilePlayerIndex ?? state.currentIndex,
    );
  }

  const drawnTile = state.boneyard[0];
  const boneyard = state.boneyard.slice(1);
  const hand = [...(state.hands[playerIndex] ?? []), drawnTile];
  const hands = state.hands.map((candidate, index) =>
    index === playerIndex ? hand : candidate,
  );
  const count = playerIndex === 0 ? state.humanDrawsThisTurn + 1 : state.humanDrawsThisTurn;
  const stillCannotMove = !canHandMove(
    hand,
    state.board,
    state.spinnerValue,
    state.isOpeningRound,
    state.openingDouble,
  );
  const autoPass =
    playerIndex === 0 &&
    count >= MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN &&
    stillCannotMove;
  return {
    accepted: true,
    state: {
      ...state,
      hands,
      boneyard,
      humanDrawsThisTurn: count,
      currentIndex: autoPass
        ? (playerIndex + 1) % state.seats.length
        : state.currentIndex,
    },
    lastPassedPlayerId: autoPass ? state.seats[playerIndex]?.id ?? null : undefined,
    scoringEvents: [],
  };
}

export function reduceAiPracticeBotDraw(
  state: AiPracticeAuthoritativeState,
  playerIndex: number,
): AiPracticeTransition {
  if (
    state.roundWinnerPlayerId ||
    state.winningTeamId ||
    playerIndex !== state.currentIndex ||
    !state.board.centerTile ||
    state.boneyard.length === 0 ||
    canHandMove(
      state.hands[playerIndex] ?? [],
      state.board,
      state.spinnerValue,
      state.isOpeningRound,
      state.openingDouble,
    )
  ) return { state, accepted: false, scoringEvents: [] };
  if (isAiPracticeRoundBlocked(state)) {
    return blockedTransition(
      state,
      state.lastTilePlayerIndex ?? state.currentIndex,
    );
  }

  const hand = [...(state.hands[playerIndex] ?? [])];
  const boneyard = [...state.boneyard];
  let draws = 0;
  while (
    draws < 3 &&
    boneyard.length > 0 &&
    !canHandMove(
      hand,
      state.board,
      state.spinnerValue,
      state.isOpeningRound,
      state.openingDouble,
    )
  ) {
    const tile = boneyard.shift();
    if (!tile) break;
    hand.push(tile);
    draws += 1;
  }
  const stillCannotMove = !canHandMove(
    hand,
    state.board,
    state.spinnerValue,
    state.isOpeningRound,
    state.openingDouble,
  );
  return {
    accepted: true,
    state: {
      ...state,
      hands: state.hands.map((candidate, index) =>
        index === playerIndex ? hand : candidate,
      ),
      boneyard,
      currentIndex: stillCannotMove
        ? (playerIndex + 1) % state.seats.length
        : state.currentIndex,
    },
    lastPassedPlayerId: stillCannotMove ? state.seats[playerIndex]?.id ?? null : undefined,
    scoringEvents: [],
  };
}

export function reduceAiPracticeBlocked(
  state: AiPracticeAuthoritativeState,
  blockerIndex: number,
): AiPracticeTransition {
  return blockedTransition(state, blockerIndex);
}