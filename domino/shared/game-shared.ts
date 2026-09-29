import { calculateMatchReward } from '@/domino/core/rules/match-rules';
import { getHandPipTotal } from '@/domino/core/engine/kozel-engine';
import type {
  DominoTileData,
  KozelBranch,
} from '@/domino/types/domino-game';

export { calculateMatchReward };

export const NEXT_ROUND_COUNTDOWN_SECONDS = 2;

// This timer starts as soon as the round winner is known, while the final tile
// presentation is still on screen (1.34s landing animation + 3s hold).
// Keep the round-result phase alive for exactly another 5s so the revealed
// hands remain visible before the next-round countdown begins.
export const ROUND_RESULT_REVEAL_MS = 9_340;

// 5s for the large Qapat announcement, then 5s for revealed hands.
export const BLOCKED_RESULT_REVEAL_MS = 10_000;

export const ROUND_TRANSITION_SYNC_MS = 1000;

export const MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN = 3;

export {
  DOMINO_HUMAN_TURN_DURATION_SECONDS as PLAYER_TURN_DURATION_SECONDS,
} from './timing/domino-turn-timer.ts';

export function pickPreferredBranch(
  branches: KozelBranch[],
  priority: KozelBranch[],
): KozelBranch {
  return (
    priority.find((branch) => branches.includes(branch)) ??
    branches[0]
  );
}

export function getBlockedRoundWinnerIndex1v1(
  blockedHands: DominoTileData[][],
) {
  const firstTotal = getHandPipTotal(blockedHands[0] ?? []);
  const secondTotal = getHandPipTotal(blockedHands[1] ?? []);

  return firstTotal <= secondTotal ? 0 : 1;
}