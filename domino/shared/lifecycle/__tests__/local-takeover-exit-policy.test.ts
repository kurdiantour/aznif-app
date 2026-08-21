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

test('1v1 and 2v2 reconcile takeover roster independently of Realtime activity', () => {
  for (const path of [
    'domino/modes/one-vs-one/controllers/use-domino-one-vs-one-connection-controller.ts',
    'domino/modes/two-vs-two/controllers/domino-two-vs-two-connection-controller.ts',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /reconcileTakeoverRoster/);
    assert.match(source, /setInterval\(\(\) => void reconcileTakeoverRoster\(\), 2_000\)/);
  }
});

test('Game Screen exits exactly once when the shared local takeover flag becomes true', () => {
  const screen = readFileSync('app/domino/game.tsx', 'utf8');
  assert.match(screen, /localPlayerTakenOver[\s\S]*?takeoverExitStartedRef[\s\S]*?router\.replace\("\/\(tabs\)\/play"\)/);
});