import { createEmptyBoard } from '@/domino/core/engine/kozel-engine';
import { NEXT_HAND_OPENING_STATE } from '@/domino/core/rules/king-rules';
import { PLAYER_TURN_DURATION_SECONDS } from '@/domino/shared/game-shared';
import { createAiPracticeDeal } from '../engine/ai-practice-engine';

export function createAiPracticeNextRound(input: {
  seatCount: number;
  leaderIndex: number;
}) {
  const deal = createAiPracticeDeal(input.seatCount);
  return {
    board: createEmptyBoard(),
    hands: deal.hands,
    boneyard: deal.boneyard,
    spinnerValue: null,
    isOpeningRound: NEXT_HAND_OPENING_STATE.isOpeningRound,
    openingDouble: NEXT_HAND_OPENING_STATE.openingDouble,
    roundWinnerPlayerId: null,
    roundEndReason: null,
    lastPlayedTile: null,
    lastPassedPlayerId: null,
    lastScoringEvent: null,
    humanDrawsThisTurn: 0,
    leaderIndex: input.leaderIndex,
    currentIndex: input.leaderIndex,
    timeLeft: PLAYER_TURN_DURATION_SECONDS,
  };
}
