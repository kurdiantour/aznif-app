import {
  DOMINO_ONE_VS_ONE_RULES,
  handPips,
  roundScore,
} from "../engine/domino-one-vs-one-engine.ts";

export type DominoOneVsOneBotRules = {
  createEmptyBoard: () => any;
  getPlayableBranches: (
    tile: any, board: any, spinnerValue: number | null,
    opening: boolean, openingDouble: number | null,
  ) => string[];
  applyMove: (
    board: any, tile: any, branch: any,
    spinnerValue: number | null, opening: boolean,
  ) => { board: any; spinnerValue: number | null; moveScore: number };
  canHandMove: (
    hand: any[], board: any, spinnerValue: number | null,
    opening: boolean, openingDouble: number | null,
  ) => boolean;
  resolveMatchOutcome: (scores: any, reward: any) => {
    winningTeamId: any;
    matchReward: any;
  };
};

export type DominoOneVsOneBotTransition = {
  nextState: any;
  nextHands: any[][];
  nextBoneyard: any[];
  nextPlayerId: string | null;
  action: "bot_play_tile" | "bot_draw_tile" | "bot_draw_tile_auto_pass" | "bot_pass_turn";
  payload: any;
};

function opening(state: any) {
  return state.isOpeningRound ?? state.isFirstRound ?? true;
}

function requiredDouble(state: any) {
  return typeof state.openingDouble === "number" ? state.openingDouble : null;
}

function counts(hands: any[][]) {
  return hands.map((hand) => hand.length);
}

export function selectDominoOneVsOneBotMove(
  hand: any[],
  state: any,
  rules: DominoOneVsOneBotRules,
) {
  const board = state.board ?? rules.createEmptyBoard();
  for (const tile of hand) {
    const branches = rules.getPlayableBranches(
      tile, board, state.spinnerValue ?? null, opening(state), requiredDouble(state),
    );
    if (branches.length) return { tile, branch: branches[0] };
  }
  return null;
}

export function reduceDominoOneVsOneBotTurn(args: {
  state: any;
  hands: any[][];
  boneyard: any[];
  players: any[];
  playerIndex: number;
  currentTurnPlayerId: string;
  rules: DominoOneVsOneBotRules;
}): DominoOneVsOneBotTransition {
  const { state, hands, boneyard, players, playerIndex, currentTurnPlayerId, rules } = args;
  const nextPlayerId = players[(playerIndex + 1) % players.length]?.user_id ?? null;
  const botMove = selectDominoOneVsOneBotMove(hands[playerIndex] ?? [], state, rules);

  if (botMove) {
    const result = rules.applyMove(
      state.board ?? rules.createEmptyBoard(), botMove.tile, botMove.branch,
      state.spinnerValue ?? null, opening(state),
    );
    const nextHands = hands.map((hand, index) => {
      if (index !== playerIndex) return hand;
      let removed = false;
      return hand.filter((tile) => {
        if (!removed && tile.id === botMove.tile.id) {
          removed = true;
          return false;
        }
        return true;
      });
    });
    const currentPlayer = players[playerIndex];
    const currentTeamId: "teamA" | "teamB" = currentPlayer.team_id;
    const nextScores = {
      teamA: Number(state.teamScores?.teamA ?? 0),
      teamB: Number(state.teamScores?.teamB ?? 0),
    };
    let lastScoringEvent = null;
    let endOfHandScoringEvent = null;
    if (result.moveScore > 0) {
      nextScores[currentTeamId] += Number(result.moveScore);
      lastScoringEvent = {
        playerId: currentTurnPlayerId, teamId: currentTeamId,
        points: result.moveScore, openEndsTotal: result.moveScore,
      };
    }

    let nextState: any = {
      ...state,
      board: result.board,
      spinnerValue: result.spinnerValue,
      handCounts: counts(nextHands),
      boneyardCount: boneyard.length,
      currentTurnPlayerId: nextPlayerId,
      currentTurnDrawCount: 0,
      isOpeningRound: false,
      isFirstRound: false,
      openingDouble: null,
      openingTileId: null,
      lastPlayedTile: botMove.tile,
      lastMoveBranch: botMove.branch,
      lastScoringEvent: null,
      endOfHandScoringEvent: null,
      lastPassedPlayerId: null,
      blockedPasses: [],
      canDrawTile: false,
    };

    if ((nextHands[playerIndex] ?? []).length === 0) {
      const opponentPips = handPips(nextHands[(playerIndex + 1) % 2] ?? []);
      const endScore = roundScore(opponentPips);
      if (endScore > 0) {
        nextScores[currentTeamId] += endScore;
        endOfHandScoringEvent = {
          playerId: currentTurnPlayerId, teamId: currentTeamId,
          points: endScore, openEndsTotal: opponentPips,
        };
      }
      const finished = rules.resolveMatchOutcome(nextScores, state.matchReward ?? null);
      nextState = {
        ...nextState,
        currentTurnPlayerId,
        leaderPlayerId: currentTurnPlayerId,
        teamScores: nextScores,
        lastScoringEvent,
        endOfHandScoringEvent,
        endOfHandScoreApplied: true,
        roundWinnerPlayerId: currentTurnPlayerId,
        roundEndReason: "empty_hand",
        revealedFinalHands: nextHands,
        winningTeamId: finished.winningTeamId,
        matchReward: finished.matchReward,
      };
    } else {
      nextState = { ...nextState, teamScores: nextScores, lastScoringEvent };
    }

    return {
      nextState, nextHands, nextBoneyard: boneyard, nextPlayerId,
      action: "bot_play_tile",
      payload: { tile: botMove.tile, branch: botMove.branch, reason: "bot_takeover" },
    };
  }

  if (
    boneyard.length > 0 && state.board?.centerTile &&
    Number(state.currentTurnDrawCount ?? 0) < DOMINO_ONE_VS_ONE_RULES.maximumHumanDrawsPerTurn
  ) {
    const drawnTile = boneyard[0];
    const nextBoneyard = boneyard.slice(1);
    const nextHands = hands.map((hand, index) =>
      index === playerIndex ? [...hand, drawnTile] : hand
    );
    const nextTurnDrawCount = Number(state.currentTurnDrawCount ?? 0) + 1;
    const canPlayAfterDraw = rules.canHandMove(
      nextHands[playerIndex] ?? [], state.board, state.spinnerValue ?? null,
      opening(state), requiredDouble(state),
    );
    // Production parity: an empty boneyard alone does not auto-pass the bot;
    // only the existing three-draw limit does.
    const shouldAutoPass = !canPlayAfterDraw &&
      nextTurnDrawCount >= DOMINO_ONE_VS_ONE_RULES.maximumHumanDrawsPerTurn;
    const nextState = {
      ...state,
      currentTurnPlayerId: shouldAutoPass ? nextPlayerId : currentTurnPlayerId,
      handCounts: counts(nextHands),
      boneyardCount: nextBoneyard.length,
      currentTurnDrawCount: shouldAutoPass ? 0 : nextTurnDrawCount,
      canDrawTile: !shouldAutoPass && !canPlayAfterDraw && nextBoneyard.length > 0,
      lastPassedPlayerId: shouldAutoPass ? currentTurnPlayerId : null,
      blockedPasses: shouldAutoPass
        ? Array.from(new Set([...(state.blockedPasses ?? []), currentTurnPlayerId]))
        : (state.blockedPasses ?? []),
    };
    return {
      nextState, nextHands, nextBoneyard, nextPlayerId,
      action: shouldAutoPass ? "bot_draw_tile_auto_pass" : "bot_draw_tile",
      payload: {
        remainingBoneyard: nextBoneyard.length,
        currentTurnDrawCount: nextTurnDrawCount,
        autoPassed: shouldAutoPass,
        reason: "bot_takeover",
      },
    };
  }

  const blockedPasses = Array.from(
    new Set([...(state.blockedPasses ?? []), currentTurnPlayerId]),
  );
  let nextState: any = {
    ...state,
    currentTurnPlayerId: nextPlayerId,
    currentTurnDrawCount: 0,
    lastPassedPlayerId: currentTurnPlayerId,
    blockedPasses,
    canDrawTile: false,
  };
  const nextIndex = (playerIndex + 1) % 2;
  const opponentCannotPlay = !rules.canHandMove(
    hands[nextIndex] ?? [], state.board, state.spinnerValue ?? null,
    opening(state), requiredDouble(state),
  );
  if (blockedPasses.length >= 2 && opponentCannotPlay) {
    const winnerIndex = handPips(hands[0] ?? []) <= handPips(hands[1] ?? []) ? 0 : 1;
    const winner = players[winnerIndex];
    const winnerTeamId: "teamA" | "teamB" = winner.team_id;
    const blockerPlayerId = state.lastMovePlayerId ?? winner.user_id;
    const opponentPips = handPips(hands[(winnerIndex + 1) % 2] ?? []);
    const blockScore = roundScore(opponentPips);
    const nextScores = {
      teamA: Number(state.teamScores?.teamA ?? 0),
      teamB: Number(state.teamScores?.teamB ?? 0),
    };
    const endOfHandScoringEvent = blockScore > 0 ? {
      playerId: winner.user_id, teamId: winnerTeamId,
      points: blockScore, openEndsTotal: opponentPips,
    } : null;
    if (blockScore > 0) nextScores[winnerTeamId] += blockScore;
    const finished = rules.resolveMatchOutcome(nextScores, state.matchReward ?? null);
    nextState = {
      ...nextState,
      currentTurnPlayerId: blockerPlayerId,
      leaderPlayerId: blockerPlayerId,
      teamScores: nextScores,
      lastScoringEvent: null,
      endOfHandScoringEvent,
      endOfHandScoreApplied: true,
      roundWinnerPlayerId: winner.user_id,
      roundEndReason: "blocked",
      winningTeamId: finished.winningTeamId,
      matchReward: finished.matchReward,
    };
  }
  return {
    nextState, nextHands: hands, nextBoneyard: boneyard, nextPlayerId,
    action: "bot_pass_turn", payload: { reason: "bot_takeover" },
  };
}
