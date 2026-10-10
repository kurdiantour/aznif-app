import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDamaMatchState,
  createDamaRoom,
  disconnectDamaPlayer,
  reconnectDamaPlayer,
  resolveDamaMoveCommand,
  resolveDamaRoomMove,
  resolveDamaTurnTimeout,
  type DamaMatchState,
} from '../authoritative.ts';
import { createGame, getLegalMoves, type GameState, type Move } from '../engine.ts';

function seedMatch(overrides: Partial<DamaMatchState> = {}): DamaMatchState {
  const base = createDamaMatchState('match-1', createGame(1_000), {
    cream: { playerId: 'cream-user', connected: true, lastSeenAtMs: 1_000 },
    black: { playerId: 'black-user', connected: true, lastSeenAtMs: 1_000 },
  }, 1_000);
  return { ...base, ...overrides };
}

function legalMoveFor(match: DamaMatchState): Move {
  const moves = getLegalMoves(match.game);
  assert.ok(moves.length > 0, 'match should have at least one legal move');
  return moves[0];
}

test('authoritative Dama match accepts a valid move for the active player and advances the turn', () => {
  const match = seedMatch();
  const move = legalMoveFor(match);
  const outcome = resolveDamaMoveCommand(
    match,
    {
      matchId: 'match-1',
      actorPlayerId: 'cream-user',
      playerColor: 'cream',
      expectedVersion: 0,
      expectedTurnId: match.turnId,
      move,
    },
    2_000,
  );

  assert.equal(outcome.accepted, true);
  if (!outcome.accepted) throw new Error('expected accepted move');
  assert.equal(outcome.state.version, 1);
  assert.equal(outcome.state.game.turn, 'black');
  assert.notEqual(outcome.state.turnId, match.turnId);
  assert.equal(outcome.state.game.ply, match.game.ply + 1);
});

test('authoritative Dama match rejects stale state versions', () => {
  const match = seedMatch();
  const move = legalMoveFor(match);
  const outcome = resolveDamaMoveCommand(
    match,
    {
      matchId: 'match-1',
      actorPlayerId: 'cream-user',
      playerColor: 'cream',
      expectedVersion: 999,
      expectedTurnId: match.turnId,
      move,
    },
    2_000,
  );

  assert.equal(outcome.accepted, false);
  if (outcome.accepted) throw new Error('expected stale-state rejection');
  assert.equal(outcome.reason, 'stale_state_version');
  assert.equal(match.version, 0);
});

test('authoritative Dama match rejects stale turn ids even when version matches', () => {
  const match = seedMatch();
  const move = legalMoveFor(match);
  const outcome = resolveDamaMoveCommand(
    match,
    {
      matchId: 'match-1',
      actorPlayerId: 'cream-user',
      playerColor: 'cream',
      expectedVersion: 0,
      expectedTurnId: 'stale-turn-id',
      move,
    },
    2_000,
  );

  assert.equal(outcome.accepted, false);
  if (outcome.accepted) throw new Error('expected stale-turn rejection');
  assert.equal(outcome.reason, 'stale_turn');
});

test('timeout resolution increments the authoritative version and advances the turn deterministically', () => {
  const match = seedMatch();
  const afterTimeout = resolveDamaTurnTimeout(match, 16_000);

  assert.equal(afterTimeout.version, 1);
  assert.equal(afterTimeout.turnId !== match.turnId, true);
  assert.equal(afterTimeout.game.turn, 'black');
  assert.equal(afterTimeout.game.turnDeadlineAtMs, 31_000);
  assert.equal(afterTimeout.game.ply, 1);
});

test('room lifecycle tracks reconnects and accepts moves only for connected active seats', () => {
  const room = createDamaRoom('room-1', { cream: 'cream-user', black: 'black-user' }, 1_000);
  const disconnected = disconnectDamaPlayer(room, 'cream-user', 'cream', 2_000);
  assert.equal(disconnected.players.cream?.connected, false);

  const reconnected = reconnectDamaPlayer(disconnected, 'cream-user', 'cream', 3_000);
  assert.equal(reconnected.players.cream?.connected, true);
  assert.equal(reconnected.match.players.cream?.connected, true);

  const move = legalMoveFor(room.match);
  const outcome = resolveDamaRoomMove(
    reconnected,
    {
      matchId: room.match.matchId,
      actorPlayerId: 'cream-user',
      playerColor: 'cream',
      expectedVersion: 0,
      expectedTurnId: room.match.turnId,
      move,
    },
    4_000,
  );

  assert.equal(outcome.accepted, true);
  if (!outcome.accepted) throw new Error('expected room move to be accepted');
  assert.equal(outcome.state.match.version, 1);
  assert.equal(outcome.state.match.game.turn, 'black');
});
