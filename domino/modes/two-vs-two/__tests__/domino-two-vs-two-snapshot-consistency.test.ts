import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('2v2 snapshot reads public state and version from the same canonical room row', () => {
  const migration = readFileSync(
    'supabase/migrations/20260820174202_fix_two_vs_two_snapshot_source_of_truth.sql',
    'utf8',
  );
  assert.match(migration, /'version', v_room\.version/);
  assert.match(migration, /COALESCE\(v_room\.state, '\{\}'::jsonb\)/);
  assert.doesNotMatch(migration, /two_vs_two_game_states|GREATEST\(/);
  assert.match(migration, /v_private\.hands -> v_player_index/);
});

test('a competing 2v2 bot worker treats an atomic stale commit as an idempotent no-op', () => {
  const worker = readFileSync('supabase/functions/process_bot_turns/index.ts', 'utf8');
  const twoVsTwoBranch = worker.slice(worker.indexOf('const completedAt = new Date().toISOString()'));
  assert.match(
    twoVsTwoBranch,
    /STALE_GAME_STATE[\s\S]*?ok: true, processed: false, reason: "stale_game_state"/,
  );
});
test('2v2 rejects a queued client pass when the latest hand is playable or turn ownership changed', () => {
  const controller = readFileSync(
    'domino/modes/two-vs-two/controllers/use-domino-two-vs-two-controller.ts',
    'utf8',
  );
  const passGuard = controller.slice(controller.indexOf('const passTurn = async'));
  assert.match(passGuard, /currentTurnPlayerId !== currentUserId/);
  assert.match(passGuard, /hasPlayableTile/);
});