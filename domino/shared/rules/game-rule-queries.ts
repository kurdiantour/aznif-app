import { canHandMove, getPlayableBranches } from '@/domino/core/engine/kozel-engine';
import type { DominoTileData, KozelBoardState, KozelBranch } from '@/types/game';

export type PlayabilityContext = {
  board: KozelBoardState;
  spinnerValue: number | null;
  isOpeningRound: boolean;
  openingDouble: number | null;
};

export function getAvailableBranches(
  tile: DominoTileData,
  context: PlayabilityContext,
): KozelBranch[] {
  try {
    return getPlayableBranches(
      tile,
      context.board,
      context.spinnerValue,
      context.isOpeningRound,
      context.openingDouble,
    );
  } catch {
    return [];
  }
}

export function handHasPlayableTile(
  hand: DominoTileData[],
  context: PlayabilityContext,
): boolean {
  try {
    return canHandMove(
      hand,
      context.board,
      context.spinnerValue,
      context.isOpeningRound,
      context.openingDouble,
    );
  } catch {
    return false;
  }
}

export function handContainsTile(hand: DominoTileData[], tileId: string): boolean {
  return hand.some((tile) => tile.id === tileId);
}
