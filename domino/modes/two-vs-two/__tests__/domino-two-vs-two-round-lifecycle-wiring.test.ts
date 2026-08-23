import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('2v2 command service owns the authoritative start-next-hand route', () => {
  const source = readFileSync(
    'domino/modes/two-vs-two/server/domino-two-vs-two-command-service.ts',
    'utf8',
  );
  assert.match(source, /DominoTwoVsTwoCommandAction = 'move' \| 'pass' \| 'start_next_hand'/);
  assert.match(source, /action !== 'start_next_hand'/);
});

test('human and bot last-tile paths commit the same shared finished-round transition', () => {
  const human = readFileSync('supabase/functions/submit_two_vs_two/move.ts', 'utf8');
  const bot = readFileSync('supabase/functions/process_bot_turns/index.ts', 'utf8');
  for (const source of [human, bot]) {
    assert.match(source, /finalizeTwoVsTwoRound/);
    assert.doesNotMatch(source, /startTwoVsTwoNextHand/);
    assert.doesNotMatch(source, /isTwoVsTwoRoundTransitionPending/);
  }
});

test('reveal and countdown precede the authoritative start-next-hand command', () => {
  const controller = readFileSync(
    'domino/modes/two-vs-two/controllers/use-domino-two-vs-two-controller.ts',
    'utf8',
  );
  const lifecycle = readFileSync(
    'domino/shared/lifecycle/use-round-lifecycle.ts',
    'utf8',
  );
  assert.match(controller, /useDominoTwoVsTwoRoundSync/);
  assert.match(controller, /buildRoundResult: createRoundResult,[\s\S]*startNextRound/);
  assert.doesNotMatch(controller, /serverAuthoritative:\s*true/);
  assert.doesNotMatch(controller, /serverRoundGateOpen|effectiveRoundWinnerPlayerId/);
  assert.match(lifecycle, /setPhase\('round_result_reveal'\)/);
  assert.match(lifecycle, /onCountdownStart: \(\) => setPhase\('next_round_countdown'\)/);
  assert.match(lifecycle, /onCountdownComplete:[\s\S]*startNextRound/);
});

test('concurrent start-next-hand requests are version-atomic and idempotent by completed round id', () => {
  const handler = readFileSync(
    'supabase/functions/submit_two_vs_two/next-hand.ts',
    'utf8',
  );
  assert.match(handler, /expected_completed_round_id/);
  assert.match(handler, /expectedVersion: room\.version/);
  assert.match(handler, /STALE_GAME_STATE/);
  assert.match(
    handler,
    /completedRoundId\(latestRoom\.state\)[\s\S]*!latestRoom\.state\?\.roundWinnerPlayerId/,
  );
});

test('new-hand King and timer originate from the same authoritative start timestamp', () => {
  const transition = readFileSync(
    'domino/modes/two-vs-two/lifecycle/domino-two-vs-two-round-transition.ts',
    'utf8',
  );
  const reducer = readFileSync(
    'domino/modes/two-vs-two/authoritative/domino-two-vs-two-command-reducer.ts',
    'utf8',
  );
  assert.match(transition, /getNextHandKingIndex/);
  assert.match(transition, /phaseStartedAt: input\.startedAt/);
  assert.match(reducer, /currentTurnPlayerId:\s*input\.leaderPlayerId/);
  assert.match(reducer, /turnStartedAt:\s*input\.phaseStartedAt/);
  assert.match(reducer, /roundStartsAt:\s*input\.phaseStartedAt/);
});
