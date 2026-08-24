import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { shouldExitLocalHumanAfterTakeover } from '../local-takeover-exit-policy.ts';

test('only the human whose own seat was taken over must exit', () => {
  const roster = [
    { user_id: 'local', bot_takeover: true },
    { user_id: 'other', bot_takeover: false },
  ];
  assert.equal(shouldExitLocalHumanAfterTakeover('local', roster), true);
  assert.equal(shouldExitLocalHumanAfterTakeover('other', roster), false);
  assert.equal(shouldExitLocalHumanAfterTakeover(null, roster), false);
});

test('Game Screen exits exactly once when the shared local takeover flag becomes true', () => {
  const screen = readFileSync('app/domino/game.tsx', 'utf8');
  assert.match(screen, /localPlayerTakenOver[\s\S]*?takeoverExitStartedRef[\s\S]*?router\.replace\("\/\(tabs\)\/play"\)/);
});
