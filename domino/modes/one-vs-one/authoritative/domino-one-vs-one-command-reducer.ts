import {
  resolveBlockedHand,
  resolveEmptyHand,
  resolveOneVsOneDrawProgress,
} from "../engine/domino-one-vs-one-engine.ts";
import { resolveMatchOutcome } from "../../../core/rules/match-rules.ts";

export type DominoOneVsOneAuthoritativeState = Record<string, any>;

export type DominoOneVsOneDrawTransition = {
  nextState: DominoOneVsOneAuthoritativeState;
  nextHands: any[][];
  nextBoneyard: any[];
  drawnTile: any;
  nextTurnDrawCount: number;
  finalTurnPlayerId: string;
  shouldAutoPass: boolean;
  stillNeedsDraw: boolean;
};

/**
 * Pure draw transition. Authentication, deadline verification and atomic
 * persistence intentionally remain outside this reducer.
 */
export function reduceOneVsOneDraw(input: {
  state: DominoOneVsOneAuthoritativeState;
  hands: any[][];
  boneyard: any[];
  activePlayerIndex: number;
  currentTurnPlayerId: string;
  opponentPlayerId: string;
  hasPlayableTileAfterDraw: (nextHand: any[]) => boolean;
  phaseStartedAt: string;
}): DominoOneVsOneDrawTransition {
  if (input.activePlayerIndex < 0 || input.activePlayerIndex > 1) {
    throw new Error("domino_1v1_invalid_active_player_index");
  }
  if (input.hands.length !== 2) {
    throw new Error("domino_1v1_requires_exactly_two_hands");
  }
  if (input.boneyard.length === 0) {
    throw new Error("domino_1v1_draw_requires_boneyard_tile");
  }

  const drawnTile = input.boneyard[0];
  const nextBoneyard = input.boneyard.slice(1);
  const nextHands = input.hands.map((hand, index) =>
    index === input.activePlayerIndex ? [...hand, drawnTile] : hand,
  );
  const stillHasPlayableTile = input.hasPlayableTileAfterDraw(
    nextHands[input.activePlayerIndex] ?? [],
  );
  const nextTurnDrawCount = Number(input.state.currentTurnDrawCount ?? 0) + 1;
  const drawProgress = resolveOneVsOneDrawProgress({
    nextTurnDrawCount,
    hasPlayableTileAfterDraw: stillHasPlayableTile,
    remainingBoneyardCount: nextBoneyard.length,
  });
  const finalTurnPlayerId = drawProgress.shouldAutoPass
    ? input.opponentPlayerId
    : input.currentTurnPlayerId;

  return {
    nextState: {
      ...input.state,
      mode: "1v1",
      currentTurnPlayerId: finalTurnPlayerId,
      turnStartedAt:
        stillHasPlayableTile || drawProgress.shouldAutoPass
          ? input.phaseStartedAt
          : input.state.turnStartedAt ?? input.phaseStartedAt,
      drawStartedAt: drawProgress.stillNeedsDraw ? input.phaseStartedAt : null,
      handCounts: nextHands.map((hand) => hand.length),
      boneyardCount: nextBoneyard.length,
      canDrawTile: drawProgress.stillNeedsDraw,
      currentTurnDrawCount: drawProgress.storedTurnDrawCount,
      lastDrawnTile: null,
      lastPassedPlayerId: drawProgress.shouldAutoPass
        ? input.currentTurnPlayerId
        : null,
      blockedPasses: drawProgress.shouldAutoPass
        ? [input.currentTurnPlayerId]
        : [],
    },
    nextHands,
    nextBoneyard,
    drawnTile,
    nextTurnDrawCount,
    finalTurnPlayerId,
    shouldAutoPass: drawProgress.shouldAutoPass,
    stillNeedsDraw: drawProgress.stillNeedsDraw,
  };
}

export function reduceOneVsOnePass(input: {
  state: DominoOneVsOneAuthoritativeState;
  hands: any[][];
  boneyard: any[];
  players: Array<{ user_id: string; team_id: "teamA" | "teamB" }>;
  playerIndex: number;
  currentTurnPlayerId: string;
  timedOut: boolean;
  phaseStartedAt: string;
  isHandPlayable: (playerIndex: number, state: DominoOneVsOneAuthoritativeState) => boolean;
  isBoneyardPlayable: (state: DominoOneVsOneAuthoritativeState) => boolean;
}) {
  if (input.players.length !== 2 || input.hands.length !== 2) {
    throw new Error("domino_1v1_requires_exactly_two_players_and_hands");
  }

  const nextPlayerIndex = (input.playerIndex + 1) % 2;
  const nextPlayerId = input.players[nextPlayerIndex]?.user_id ?? null;
  const openingTimeoutWaived =
    input.timedOut &&
    !input.state.board?.centerTile &&
    (input.state.isOpeningRound ?? input.state.isFirstRound ?? true);
  const turnRuleState = openingTimeoutWaived
    ? {
        ...input.state,
        isOpeningRound: false,
        isFirstRound: false,
        openingDouble: null,
        openingTileId: null,
      }
    : input.state;
  const blockedPasses = Array.from(
    new Set([...(input.state.blockedPasses ?? []), input.currentTurnPlayerId]),
  );
  const nextScores = {
    teamA: Number(input.state.teamScores?.teamA ?? 0),
    teamB: Number(input.state.teamScores?.teamB ?? 0),
  };
  let nextTurnPlayerId = nextPlayerId;
  let nextStatus = "active";
  let nextState: DominoOneVsOneAuthoritativeState = {
    ...turnRuleState,
    mode: "1v1",
    currentTurnPlayerId: nextPlayerId,
    canDrawTile: false,
    drawStartedAt: null,
    currentTurnDrawCount: 0,
    lastPassedPlayerId: input.currentTurnPlayerId,
    turnStartedAt: input.phaseStartedAt,
    lastScoringEvent: null,
    endOfHandScoringEvent: null,
    blockedPasses,
  };

  const opponentCannotPlay = !input.isHandPlayable(nextPlayerIndex, turnRuleState);
  if (blockedPasses.length >= 2 && opponentCannotPlay) {
    const handResult = resolveBlockedHand(input.hands);
    const winner = input.players[handResult.winnerIndex];
    const blockerPlayerId = input.state.lastMovePlayerId ?? winner.user_id;
    let endOfHandScoringEvent = null;

    if (handResult.awardedPoints > 0) {
      nextScores[winner.team_id] += handResult.awardedPoints;
      endOfHandScoringEvent = {
        playerId: winner.user_id,
        teamId: winner.team_id,
        points: handResult.awardedPoints,
        openEndsTotal: handResult.remainingPips,
      };
    }

    const finished = resolveMatchOutcome(nextScores, input.state.matchReward ?? null);
    nextTurnPlayerId = blockerPlayerId;
    nextStatus = finished.winningTeamId ? "finished" : "active";
    nextState = {
      ...nextState,
      currentTurnPlayerId: nextTurnPlayerId,
      teamScores: nextScores,
      roundWinnerPlayerId: winner.user_id,
      leaderPlayerId: blockerPlayerId,
      endOfHandScoringEvent,
      roundEndReason: "blocked",
      revealedFinalHands: input.hands,
      winningTeamId: finished.winningTeamId,
      matchReward: finished.matchReward,
      endOfHandScoreApplied: true,
      drawStartedAt: null,
    };
  } else {
    const nextPlayerMustDraw = Boolean(
      nextPlayerId &&
        !input.isHandPlayable(nextPlayerIndex, turnRuleState) &&
        input.isBoneyardPlayable(turnRuleState) &&
        input.boneyard.length > 0,
    );
    nextState = {
      ...nextState,
      canDrawTile: nextPlayerMustDraw,
      drawStartedAt: nextPlayerMustDraw ? input.phaseStartedAt : null,
    };
  }

  return {
    nextState,
    nextHands: input.hands,
    nextBoneyard: input.boneyard,
    nextTurnPlayerId,
    nextStatus,
  };
}
export function reduceOneVsOnePlay(input: {
  state: DominoOneVsOneAuthoritativeState;
  hands: any[][];
  boneyard: any[];
  players: Array<{
    user_id: string;
    team_id: "teamA" | "teamB";
    player_index: number;
  }>;
  playerIndex: number;
  actorUserId: string;
  tile: any;
  branch?: string | null;
  nextBoard: any;
  nextSpinnerValue: number | null;
  moveScore: number;
  phaseStartedAt: string;
  isSameTile: (handTile: any, submittedTile: any) => boolean;
  canNextPlayerDraw: (
    nextTurnPlayerId: string,
    nextHands: any[][],
    nextState: DominoOneVsOneAuthoritativeState,
  ) => boolean;
}) {
  if (input.players.length !== 2 || input.hands.length !== 2) {
    throw new Error("domino_1v1_requires_exactly_two_players_and_hands");
  }

  let removedTile = false;
  const nextHands = input.hands.map((hand, index) => {
    if (index !== input.playerIndex) return hand;
    return hand.filter((handTile) => {
      if (!removedTile && input.isSameTile(handTile, input.tile)) {
        removedTile = true;
        return false;
      }
      return true;
    });
  });
  if (!removedTile) throw new Error("domino_1v1_tile_not_found_in_hand");

  const nextPlayerIndex = (input.playerIndex + 1) % 2;
  const currentPlayer = input.players.find(
    (player) => player.player_index === input.playerIndex,
  );
  const nextPlayer = input.players.find(
    (player) => player.player_index === nextPlayerIndex,
  );
  if (!currentPlayer || !nextPlayer?.user_id) {
    throw new Error("domino_1v1_invalid_player_mapping");
  }

  const nextScores = {
    teamA: Number(input.state.teamScores?.teamA ?? 0),
    teamB: Number(input.state.teamScores?.teamB ?? 0),
  };
  let lastScoringEvent = null;
  let endOfHandScoringEvent = null;
  if (input.moveScore > 0) {
    nextScores[currentPlayer.team_id] += Number(input.moveScore);
    lastScoringEvent = {
      playerId: input.actorUserId,
      teamId: currentPlayer.team_id,
      points: input.moveScore,
      openEndsTotal: input.moveScore,
    };
  }

  let nextTurnPlayerId = nextPlayer.user_id;
  let roundWinnerPlayerId = null;
  let winningTeamId = null;
  let reward = null;
  if (nextHands[input.playerIndex]?.length === 0) {
    roundWinnerPlayerId = input.actorUserId;
    nextTurnPlayerId = input.actorUserId;
    const handResult = resolveEmptyHand(nextHands, input.playerIndex as 0 | 1);
    if (handResult.awardedPoints > 0) {
      nextScores[currentPlayer.team_id] += handResult.awardedPoints;
      endOfHandScoringEvent = {
        playerId: input.actorUserId,
        teamId: currentPlayer.team_id,
        points: handResult.awardedPoints,
        openEndsTotal: handResult.remainingPips,
      };
    }
    const finished = resolveMatchOutcome(nextScores, input.state.matchReward ?? null);
    winningTeamId = finished.winningTeamId;
    reward = finished.matchReward;
  }

  let nextState: DominoOneVsOneAuthoritativeState = {
    ...input.state,
    mode: "1v1",
    board: input.nextBoard,
    spinnerValue: input.nextSpinnerValue,
    currentTurnDrawCount: 0,
    handCounts: nextHands.map((hand) => hand.length),
    boneyardCount: input.boneyard.length,
    currentTurnPlayerId: nextTurnPlayerId,
    turnStartedAt: input.phaseStartedAt,
    drawStartedAt: null,
    leaderPlayerId:
      roundWinnerPlayerId ?? input.state.leaderPlayerId ?? input.actorUserId,
    isOpeningRound: false,
    isFirstRound: false,
    openingDouble: null,
    openingTileId: null,
    lastPlayedTile: input.tile,
    lastMovePlayerId: input.actorUserId,
    lastMoveBranch: input.branch ?? null,
    lastScoringEvent,
    endOfHandScoringEvent,
    endOfHandScoreApplied: Boolean(roundWinnerPlayerId),
    teamScores: nextScores,
    roundWinnerPlayerId,
    roundEndReason: roundWinnerPlayerId ? "empty_hand" : null,
    revealedFinalHands: roundWinnerPlayerId ? nextHands : null,
    winningTeamId,
    matchReward: reward,
    lastPassedPlayerId: null,
    blockedPasses: [],
    canDrawTile: false,
  };

  if (!roundWinnerPlayerId) {
    const canDrawTile = input.canNextPlayerDraw(
      nextTurnPlayerId,
      nextHands,
      nextState,
    );
    nextState = {
      ...nextState,
      canDrawTile,
      drawStartedAt: canDrawTile ? input.phaseStartedAt : null,
    };
  }

  return {
    nextState,
    nextHands,
    nextBoneyard: input.boneyard,
    nextTurnPlayerId,
    status: winningTeamId ? "finished" : "active",
    winningTeamId,
  };
}