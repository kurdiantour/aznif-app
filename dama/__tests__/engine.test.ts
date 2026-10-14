import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseBotMove } from '../bot.ts';
import { applyMove, createGame, DAMA_TURN_DURATION_MS, getLegalMoves, getTurnRemainingMs, projectMove, resolveTurnTimeout, type GameState, type Piece } from '../engine.ts';

const piece = (id: string, color: Piece['color'], row: number, column: number, king = false): Piece => ({ id, color, row, column, king });
const position = (pieces: Piece[], turn: GameState['turn'] = 'cream'): GameState => ({ pieces, turn, ply: 0, result: null });

test('initial placement and orthogonal man moves', () => {
  const game = createGame();
  assert.equal(game.pieces.length, 32);
  assert.equal(game.pieces.filter((candidate) => candidate.color === 'cream').length, 16);
  const moves = getLegalMoves(game);
  assert.ok(moves.length > 0);
  assert.ok(moves.every((move) => move.steps.length === 1 && !move.steps[0].capturedId));
  assert.ok(moves.every((move) => move.steps[0].to.row <= move.from.row));
});

test('move validation rejects a forged origin square', () => {
  const game = createGame(1_000);
  const legal = getLegalMoves(game)[0];
  assert.throws(() => applyMove(game, { ...legal, from: { row: legal.from.row + 1, column: legal.from.column } }, 1_001), /Illegal Dama move/);
});

test('capture is compulsory, maximal sequence wins, captured pieces disappear immediately', () => {
  const game = position([
    piece('a', 'cream', 5, 1), piece('b', 'cream', 5, 6),
    piece('x', 'black', 4, 1), piece('y', 'black', 2, 1), piece('z', 'black', 5, 5),
  ]);
  const moves = getLegalMoves(game);
  assert.ok(moves.length > 0);
  assert.ok(moves.every((move) => move.pieceId === 'a' && move.steps.length === 2));
  const halfway = projectMove(game, moves[0], 1);
  assert.equal(halfway.pieces.some((candidate) => candidate.id === 'x'), false);
  assert.equal(halfway.turn, 'cream');
  const complete = applyMove(game, moves[0]);
  assert.equal(complete.turn, 'black');
  assert.equal(complete.pieces.some((candidate) => candidate.id === 'y'), false);
  assert.throws(() => applyMove(game, { pieceId: 'b', from: { row: 5, column: 6 }, steps: [{ to: { row: 5, column: 4 }, capturedId: 'z' }] }));
});

test('men cannot move or capture backward', () => {
  const game = position([piece('a', 'cream', 3, 3), piece('x', 'black', 4, 3), piece('y', 'black', 2, 3)]);
  const moves = getLegalMoves(game);
  assert.ok(moves.every((move) => move.steps[0].capturedId === 'y'));
  assert.ok(moves.every((move) => move.steps[0].to.row === 1));
});

test('men move sideways and kings move in all four orthogonal directions', () => {
  const man = position([piece('a', 'cream', 4, 4), piece('x', 'black', 0, 0)]);
  const manTargets = getLegalMoves(man).map((move) => move.steps[0].to);
  assert.ok(manTargets.some((to) => to.row === 4 && to.column === 3));
  assert.ok(manTargets.some((to) => to.row === 4 && to.column === 5));
  assert.ok(!manTargets.some((to) => to.row === 5));
  const king = position([piece('a', 'cream', 4, 4, true), piece('x', 'black', 0, 0)]);
  const kingTargets = getLegalMoves(king).map((move) => move.steps[0].to);
  assert.ok(kingTargets.some((to) => to.row === 7 && to.column === 4));
  assert.ok(kingTargets.some((to) => to.row === 0 && to.column === 4));
});

test('promotion occurs only after finishing the turn', () => {
  const game = position([
    piece('a', 'cream', 2, 2), piece('x', 'black', 1, 2), piece('y', 'black', 0, 4),
    piece('spare', 'black', 7, 7),
  ]);
  const move = getLegalMoves(game)[0];
  assert.equal(move.steps.length, 1);
  assert.equal(projectMove(game, move).pieces.find((candidate) => candidate.id === 'a')?.king, false);
  assert.equal(applyMove(game, move).pieces.find((candidate) => candidate.id === 'a')?.king, true);
});

test('flying kings land beyond a victim and cannot reverse in the same capture', () => {
  const game = position([
    piece('a', 'cream', 4, 1, true), piece('x', 'black', 4, 4), piece('y', 'black', 4, 0),
    piece('spare', 'black', 7, 7),
  ]);
  const moves = getLegalMoves(game);
  assert.ok(moves.some((move) => move.steps[0].to.column === 5));
  assert.ok(moves.some((move) => move.steps[0].to.column === 6));
  assert.ok(moves.every((move) => move.steps.length === 1));
  assert.ok(moves.every((move) => move.steps[0].capturedId === 'x'));
});

test('loss by no pieces and no mobility; one against one is a draw', () => {
  const finalCapture = position([piece('a', 'cream', 3, 3), piece('x', 'black', 2, 3)]);
  assert.deepEqual(applyMove(finalCapture, getLegalMoves(finalCapture)[0]).result, { winner: 'cream', reason: 'no-pieces' });
  const blocked = position([
    piece('a', 'cream', 7, 2), piece('b', 'cream', 7, 3), piece('c', 'cream', 5, 5),
    piece('x', 'black', 7, 0), piece('y', 'black', 7, 1),
  ]);
  const next = applyMove(blocked, getLegalMoves(blocked).find((move) => move.pieceId === 'c')!);
  assert.deepEqual(next.result, { winner: 'cream', reason: 'no-moves' });
  const draw = position([piece('a', 'cream', 5, 0), piece('x', 'black', 0, 7)]);
  const drawMove = getLegalMoves(draw)[0];
  assert.deepEqual(applyMove(draw, drawMove).result, { winner: null, reason: 'one-vs-one' });
});

test('bot chooses a legal move and plays against the same engine', () => {
  let game = createGame();
  for (let turn = 0; turn < 500 && !game.result; turn++) {
    const move = game.turn === 'black' ? chooseBotMove(game) : getLegalMoves(game)[0];
    assert.ok(move);
    game = applyMove(game, move);
  }
  assert.ok(game.ply > 10);
  assert.ok(game.result, 'a full game must reach a result');
});

test('quiet move and repeated position limits resolve endless games as draws', () => {
  const base = position([
    piece('a', 'cream', 5, 0), piece('b', 'cream', 5, 1),
    piece('x', 'black', 0, 6), piece('y', 'black', 0, 7),
  ]);
  const move = getLegalMoves(base)[0];
  assert.deepEqual(applyMove({ ...base, quietPly: 79 }, move).result, { winner: null, reason: 'quiet-limit' });
  const first = applyMove(base, move);
  const key = Object.keys(first.history!)[0];
  assert.deepEqual(applyMove({ ...base, history: { [key]: 2 } }, move).result, { winner: null, reason: 'repetition' });
});

test('each human and bot turn gets exactly 15 seconds from the engine', () => {
  const started = createGame(1_000);
  assert.equal(DAMA_TURN_DURATION_MS, 15_000);
  assert.equal(started.turnDeadlineAtMs, 16_000);
  assert.equal(getTurnRemainingMs(started, 1_000), 15_000);
  assert.equal(getTurnRemainingMs(started, 8_500), 7_500);
  assert.equal(getTurnRemainingMs(started, 16_000), 0);
  assert.equal(resolveTurnTimeout(started, 15_999), started);

  const afterHuman = applyMove(started, getLegalMoves(started)[0], 4_000);
  assert.equal(afterHuman.turn, 'black');
  assert.equal(afterHuman.turnStartedAtMs, 4_000);
  assert.equal(afterHuman.turnDeadlineAtMs, 19_000);

  const afterBot = applyMove(afterHuman, getLegalMoves(afterHuman)[0], 5_000);
  assert.equal(afterBot.turn, 'cream');
  assert.equal(afterBot.turnDeadlineAtMs, 20_000);
});

test('engine rejects late moves and resolves exactly one legal move per timeout event', () => {
  const started = createGame(1_000);
  const first = getLegalMoves(started)[0];
  assert.throws(() => applyMove(started, first, 16_000), /expired/);
  const afterHumanTimeout = resolveTurnTimeout(started, 16_000);
  assert.equal(afterHumanTimeout.ply, 1);
  assert.equal(afterHumanTimeout.turn, 'black');
  assert.equal(afterHumanTimeout.turnDeadlineAtMs, 31_000);
  assert.equal(afterHumanTimeout.pieces.find((piece) => piece.id === first.pieceId)?.row, first.steps[0].to.row);
  assert.equal(afterHumanTimeout.timeoutStrikes?.cream, 1);
  const afterBotTimeout = resolveTurnTimeout(afterHumanTimeout, 31_000);
  assert.equal(afterBotTimeout.ply, 2);
  assert.equal(afterBotTimeout.turn, 'cream');
  assert.equal(afterBotTimeout.turnDeadlineAtMs, 46_000);
  const delayedLifecycle = resolveTurnTimeout(started, 46_000);
  assert.equal(delayedLifecycle.ply, 1);
  assert.equal(delayedLifecycle.turn, 'black');
  assert.equal(delayedLifecycle.turnDeadlineAtMs, 31_000);
  assert.equal(delayedLifecycle.timeoutStrikes?.cream, 1);
});

test('restoring human control clears that side timeout strike', async () => {
  const { restoreHumanControl } = await import('../engine.ts');
  const state = { ...createGame(0), timeoutStrikes: { cream: 2, black: 1 } };
  assert.deepEqual(restoreHumanControl(state, 'cream').timeoutStrikes, { cream: 0, black: 1 });
});
