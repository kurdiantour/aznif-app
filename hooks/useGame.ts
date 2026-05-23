import { GameMode } from '@/types/game';
import useMultiplayerGame from './useMultiplayerGame';
import { useAiPracticeGame } from './useAiPracticeGame';
import { MockGameState } from './useGameBase';

export function useGame(
  mode: GameMode = '2v2',
  practice = false,
  gameId?: string,
): MockGameState {
  /**
   * Practice / offline mode only.
   */
  if (practice) {
    return useAiPracticeGame();
  }

  /**
   * Real multiplayer mode.
   */
  return useMultiplayerGame(gameId) as unknown as MockGameState;
}