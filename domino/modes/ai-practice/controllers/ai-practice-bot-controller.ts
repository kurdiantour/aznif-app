import { findBestBotMove } from '@/domino/core/bot/bot-ai';
import type { DominoTileData, KozelBoardState } from '@/domino/types/domino-game';

export type AiPracticeBotDecision =
  | { type: 'play'; tile: DominoTileData; branch: any }
  | { type: 'resolve-blocked' }
  | { type: 'draw' }
  | { type: 'pass' };

export function decideAiPracticeBotTurn(input: {
  hand: DominoTileData[];
  board: KozelBoardState;
  spinnerValue: number | null;
  isOpeningRound: boolean;
  openingDouble: number | null;
  roundBlocked: boolean;
  boneyardCount: number;
}): AiPracticeBotDecision {
  const move = findBestBotMove(
    input.hand,
    input.board,
    input.spinnerValue,
    input.isOpeningRound,
    input.openingDouble,
  );
  if (move) return { type: 'play', tile: move.tile, branch: move.branch };
  if (input.roundBlocked) return { type: 'resolve-blocked' };
  if (input.board.centerTile && input.boneyardCount > 0) return { type: 'draw' };
  return { type: 'pass' };
}

export function scheduleAiPracticeBotTurn(
  run: () => void,
  delayMs = 700,
): () => void {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
}
