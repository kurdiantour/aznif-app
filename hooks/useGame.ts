import type { GameMode } from '@/types/game';
import { useAiPracticeGame } from './useAiPracticeGame';
import type { MockGameState } from './useGameBase';
import { useOneVsOneGame } from './useOneVsOneGame';
import { useTwoVsTwoGame } from './useTwoVsTwoGame';

export function useGame(
  mode: GameMode = '2v2',
  practice = false,
  gameId?: string,
): MockGameState {
  const practiceGame = useAiPracticeGame();

  const oneVsOneGame = useOneVsOneGame(!practice && mode === '1v1' ? gameId : undefined);

  const twoVsTwoGame = useTwoVsTwoGame(!practice && mode === '2v2' ? gameId : undefined);

  if (practice) {
    return practiceGame;
  }

  if (mode === '1v1') {
    return oneVsOneGame as unknown as MockGameState;
  }

  return twoVsTwoGame as unknown as MockGameState;
}