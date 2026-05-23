import { useMemo } from 'react';
import {
    awardEndOfHandPoints2v2,
    createTwoVsTwoSeats,
    getBotMoveFor2v2,
    resolveBlockedRound2v2,
} from './gameShared';
import { useGameBase } from './useGameBase';

export function useTwoVsTwoGame() {
  const seats = useMemo(() => createTwoVsTwoSeats(), []);

  return useGameBase({
    mode: '2v2',
    seats,
    getBotMove: getBotMoveFor2v2,
    canDrawTile: () => false,
    shouldRefusePassBecauseDrawAvailable: () => false,
    resolveBlockedRound: resolveBlockedRound2v2,
    awardEndOfHandPoints: awardEndOfHandPoints2v2,
    scoringEnabled: true,
    botCanDrawUntilPlayable: false,
  });
}
