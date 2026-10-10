import { projectMove, type GameState, type Move, type Piece, type Square } from './engine.ts';

export type BotPlaybackFrame = {
  state: GameState;
  moving: { piece: Piece; from: Square; to: Square } | null;
};

export function getBotPlaybackFrame(source: GameState, move: Move, completedSteps: number): BotPlaybackFrame {
  if (completedSteps < 0 || completedSteps > move.steps.length) throw new Error('Invalid Bot playback step');
  const state = projectMove(source, move, completedSteps);
  const next = move.steps[completedSteps];
  const piece = state.pieces.find((candidate) => candidate.id === move.pieceId);
  return {
    state,
    moving: next && piece ? {
      piece,
      from: { row: piece.row, column: piece.column },
      to: next.to,
    } : null,
  };
}
