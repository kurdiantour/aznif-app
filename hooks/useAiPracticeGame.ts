import { useMemo } from 'react';
import {
  canDrawTileFor1v1,
  createOneVsOneSeats,
  getBotMoveFor1v1,
  resolveBlockedRound1v1,
  shouldRefusePassBecauseDrawAvailable1v1,
  awardEndOfHandPoints1v1,
} from './gameShared';
import { useGameBase } from './useGameBase';

export function useAiPracticeGame() {
  const seats = useMemo(() => createOneVsOneSeats(), []);

  return useGameBase({
    mode: '1v1',
    seats,
    getBotMove: getBotMoveFor1v1,
    canDrawTile: canDrawTileFor1v1,
    shouldRefusePassBecauseDrawAvailable: shouldRefusePassBecauseDrawAvailable1v1,
    resolveBlockedRound: resolveBlockedRound1v1,
    awardEndOfHandPoints: awardEndOfHandPoints1v1,
    scoringEnabled: true,
    botCanDrawUntilPlayable: true,
  });
}