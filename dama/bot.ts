import { applyMove, getLegalMoves, type GameState, type Move } from './engine.ts';

export function chooseBotMove(state: GameState): Move | null {
  const moves = getLegalMoves(state);
  if (!moves.length) return null;
  const score = (move: Move) => {
    const after = applyMove(state, move);
    if (after.result?.winner === state.turn) return 10000;
    const opponentCaptures = getLegalMoves(after)[0]?.steps.filter((step) => step.capturedId).length ?? 0;
    const destination = move.steps[move.steps.length - 1].to;
    const promotion = after.pieces.find((piece) => piece.id === move.pieceId)?.king ? 3 : 0;
    return move.steps.filter((step) => step.capturedId).length * 20 + promotion - opponentCaptures * 8 +
      (3.5 - Math.abs(3.5 - destination.column)) * 0.1;
  };
  return [...moves].sort((a, b) => score(b) - score(a))[0];
}
