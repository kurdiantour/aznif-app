import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260820141129_domino_two_vs_two_team_takeover_terminal_round.sql',
  'utf8',
);
const rollback = readFileSync(
  'supabase/rollbacks/20260820141129_domino_two_vs_two_team_takeover_terminal_round.rollback.sql',
  'utf8',
);

test('one takeover is non-terminal and a complete two-seat team is required', () => {
  assert.match(migration, /COUNT\(\*\)[\s\S]*?= 2/);
  assert.match(migration, /NOT EXISTS \([\s\S]*?member\.team_id = team\.team_id/);
  assert.match(migration, /roundWinnerPlayerId/);
});

test('manual leave and second-timeout takeover are the only terminal causes', () => {
  assert.match(migration, /'manual_leave_takeover',[\s\S]*?'timeout_takeover'/);
  assert.match(migration, /event\.action = 'timeout_takeover'/);
  const resolver = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.resolve_two_vs_two_round_leave_forfeits'));
  assert.doesNotMatch(resolver, /last_seen_at|heartbeat|takeover_expires_at/);
});

test('team takeover finishes after round through one resolver', () => {
  assert.match(migration, /finalize_two_vs_two_takeover_after_round/);
  assert.match(migration, /PERFORM public\.resolve_two_vs_two_round_leave_forfeits\(NEW\.id\)/);
  assert.match(migration, /round_end_team_takeover_forfeit/);
  assert.match(migration, /public\.domino_settle_match\('2v2', p_room_id\)/);
});

test('policy migration has a complete rollback', () => {
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.finalize_two_vs_two_takeover_after_round/);
  assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.apply_two_vs_two_timeout_strike_takeover/);
  assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.resolve_two_vs_two_round_leave_forfeits/);
  assert.doesNotMatch(rollback, /timeout_takeover/);
});
