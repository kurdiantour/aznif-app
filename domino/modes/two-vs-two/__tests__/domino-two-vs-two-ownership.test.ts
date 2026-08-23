import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('2v2 dispatcher delegates stable actions to its mode command service', () => {
  const source = readFileSync('supabase/functions/submit_two_vs_two/index.ts', 'utf8');
  assert.match(source, /DominoTwoVsTwoCommandService/);
  assert.match(source, /move,/);
  assert.match(source, /pass,/);
  assert.match(source, /start_next_hand/);
  assert.doesNotMatch(source, /switch \(action\)/);
});

test('2v2 presentation delegates snapshot auth roster and commands to its adapter', () => {
  const source = readFileSync(
    'domino/modes/two-vs-two/controllers/use-domino-two-vs-two-controller.ts',
    'utf8',
  );
  assert.match(source, /adapter\.getSnapshot\(\)/);
  const connection = readFileSync('domino/modes/two-vs-two/controllers/domino-two-vs-two-connection-controller.ts', 'utf8');
  assert.match(connection, /adapter!\.getCurrentUserId\(\)/);
  assert.match(connection, /adapter!\.subscribe/);
  assert.match(source, /adapter\.getRoster\(includeProfiles\)/);
  assert.match(source, /adapter!\.dispatch/);
  assert.doesNotMatch(source, /supabase\.auth\.getUser/);
  assert.doesNotMatch(source, /\.from\('two_vs_two_players'\)/);
});

test('2v2 transition and runtime ownership are complete', () => {
  const ownership = readFileSync('domino/OWNERSHIP.md', 'utf8');
  assert.match(ownership, /authoritative\/domino-two-vs-two-command-reducer\.ts/);
  assert.match(ownership, /timeout\/bot controllers/);
  assert.doesNotMatch(
    ownership,
    /transition bodies remain in Edge handlers|extraction pending/,
  );
});

test('2v2 Edge handlers delegate transitions and commits to mode server ownership', () => {
  for (const path of [
    'supabase/functions/submit_two_vs_two/move.ts',
    'supabase/functions/submit_two_vs_two/pass.ts',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /reduceTwoVsTwo/);
    assert.match(source, /buildTwoVsTwoCommit/);
  }
  assert.match(readFileSync('supabase/functions/submit_two_vs_two/move.ts', 'utf8'), /finalizeTwoVsTwoRound/);
  assert.equal(existsSync('supabase/functions/submit_two_vs_two/next-hand.ts'), true);
  assert.match(readFileSync('supabase/functions/submit_two_vs_two/next-hand.ts', 'utf8'), /startTwoVsTwoNextHand/);
  const bot = readFileSync('supabase/functions/process_bot_turns/index.ts', 'utf8');
  assert.match(bot, /reduceTwoVsTwoPlay/);
  assert.match(bot, /reduceTwoVsTwoBotPass/);
});