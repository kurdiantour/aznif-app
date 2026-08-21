import assert from 'node:assert/strict';
import test from 'node:test';

import { assignDominoBotIdentities } from '../bot-identity.ts';

test('Domino bot identities are stable across reconnect and round projections', () => {
  const seats = [
    { id: 'room-player-a', playerIndex: 0 },
    { id: 'room-player-b', playerIndex: 1 },
  ];
  const first = assignDominoBotIdentities(seats);
  const reconnect = assignDominoBotIdentities([...seats].reverse());

  assert.deepEqual([...reconnect], [...first]);
  for (const identity of first.values()) {
    assert.match(identity.name, /^Bot [3-9]\d{2}$/);
  }
});

test('Domino bot identities do not repeat inside one match', () => {
  const identities = assignDominoBotIdentities(
    Array.from({ length: 20 }, (_, playerIndex) => ({
      id: `seat-${playerIndex}`,
      playerIndex,
    })),
  );
  const numbers = [...identities.values()].map((identity) => identity.number);

  assert.equal(new Set(numbers).size, numbers.length);
});