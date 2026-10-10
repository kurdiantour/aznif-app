import assert from 'node:assert/strict';
import test from 'node:test';

import { getBotPlaybackFrame } from '../bot-presentation.ts';
import { applyMove, getLegalMoves, type GameState } from '../engine.ts';

test('Bot capture playback visits every landing and removes each victim after that step', () => {
  const source: GameState = {
    turn: 'black', ply: 3, result: null,
    pieces: [
      { id: 'bot', color: 'black', row: 2, column: 2, king: false },
      { id: 'first', color: 'cream', row: 3, column: 2, king: false },
      { id: 'second', color: 'cream', row: 5, column: 2, king: false },
      { id: 'spare', color: 'cream', row: 7, column: 7, king: false },
    ],
  };
  const move = getLegalMoves(source).find((candidate) => candidate.pieceId === 'bot')!;
  assert.equal(move.steps.length, 2);

  const first = getBotPlaybackFrame(source, move, 0);
  assert.deepEqual(first.moving?.from, { row: 2, column: 2 });
  assert.deepEqual(first.moving?.to, { row: 4, column: 2 });
  assert.equal(first.state.pieces.length, 4);
  assert.equal(first.state.turn, 'black');

  const second = getBotPlaybackFrame(source, move, 1);
  assert.deepEqual(second.moving?.from, { row: 4, column: 2 });
  assert.deepEqual(second.moving?.to, { row: 6, column: 2 });
  assert.equal(second.state.pieces.some((piece) => piece.id === 'first'), false);
  assert.equal(second.state.pieces.some((piece) => piece.id === 'second'), true);
  assert.equal(second.state.turn, 'black');

  const finished = getBotPlaybackFrame(source, move, 2);
  assert.equal(finished.moving, null);
  assert.equal(finished.state.pieces.some((piece) => piece.id === 'second'), false);
  assert.equal(finished.state.turn, 'black');
  assert.equal(applyMove(source, move).turn, 'cream');
});
