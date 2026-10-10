import assert from 'node:assert/strict';
import test from 'node:test';

import { createDamaRoom } from '../authoritative.ts';
import { getLegalMoves } from '../engine.ts';
import { DamaServerContract } from '../server-contract.ts';

test('server contract can create a room and return a snapshot', async () => {
  const service = new DamaServerContract();
  const response = await service.handle(
    new Request('http://localhost/dama', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        roomId: 'room-create',
        players: { cream: 'cream-user', black: 'black-user' },
      }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    snapshot: { roomId: string; players: Record<string, { playerId: string } | null> };
  };
  assert.equal(payload.snapshot.roomId, 'room-create');
  assert.equal(payload.snapshot.players.cream?.playerId, 'cream-user');
});

test('server contract can join a room and return a snapshot', async () => {
  const service = new DamaServerContract();
  const response = await service.handle(
    new Request('http://localhost/dama', {
      method: 'POST',
      body: JSON.stringify({
        action: 'join',
        roomId: 'room-join',
        playerId: 'cream-user',
        color: 'cream',
      }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    snapshot: { roomId: string; players: Record<string, { playerId: string } | null> };
  };
  assert.equal(payload.snapshot.roomId, 'room-join');
  assert.equal(payload.snapshot.players.cream?.playerId, 'cream-user');
});

test('server contract accepts a valid move and advances the room turn', async () => {
  const now = Date.now();
  const room = createDamaRoom('room-move', { cream: 'cream-user', black: 'black-user' }, now);
  const service = new DamaServerContract([[room.roomId, room]]);
  const move = getLegalMoves(room.match.game)[0];

  const response = await service.handle(
    new Request('http://localhost/dama', {
      method: 'POST',
      body: JSON.stringify({
        action: 'move',
        matchId: room.match.matchId,
        actorPlayerId: 'cream-user',
        playerColor: 'cream',
        expectedVersion: 0,
        expectedTurnId: room.match.turnId,
        move,
      }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    snapshot: { turn: 'cream' | 'black'; version: number };
  };
  assert.equal(payload.snapshot.turn, 'black');
  assert.equal(payload.snapshot.version, 1);
});

test('server contract reconnects a player seat cleanly', async () => {
  const room = createDamaRoom('room-reconnect', { cream: 'cream-user', black: 'black-user' }, 1_000);
  const service = new DamaServerContract([[room.roomId, room]]);

  const disconnectResponse = await service.handle(
    new Request('http://localhost/dama', {
      method: 'POST',
      body: JSON.stringify({
        action: 'leave',
        roomId: room.roomId,
        playerId: 'cream-user',
        color: 'cream',
      }),
    }),
  );
  assert.equal(disconnectResponse.status, 200);

  const reconnectResponse = await service.handle(
    new Request('http://localhost/dama', {
      method: 'POST',
      body: JSON.stringify({
        action: 'reconnect',
        roomId: room.roomId,
        playerId: 'cream-user',
        color: 'cream',
      }),
    }),
  );

  assert.equal(reconnectResponse.status, 200);
  const payload = (await reconnectResponse.json()) as { snapshot: { players: Record<string, { connected: boolean } | null> } };
  assert.equal(payload.snapshot.players.cream?.connected, true);
});

test('server contract rejects stale timeout proposals', async () => {
  const room = createDamaRoom('room-timeout', { cream: 'cream-user', black: 'black-user' }, 1_000);
  const service = new DamaServerContract([[room.roomId, room]]);

  const response = await service.handle(
    new Request('http://localhost/dama', {
      method: 'POST',
      body: JSON.stringify({
        action: 'timeout',
        roomId: room.roomId,
        actorPlayerId: 'cream-user',
        playerColor: 'cream',
        expectedVersion: 999,
        expectedTurnId: room.match.turnId,
      }),
    }),
  );

  assert.equal(response.status, 409);
  const payload = (await response.json()) as { reason: string };
  assert.equal(payload.reason, 'stale_state_version');
});
