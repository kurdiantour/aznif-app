import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("database deadline invariant is phase-aware and independent from timeout history", () => {
  const migration = readFileSync(
    "supabase/migrations/20260827175953_okey_phase_aware_turn_deadlines.sql",
    "utf8",
  );

  assert.match(migration, /v_old_has_drawn is distinct from v_new_has_drawn/);
  assert.match(migration, /if v_player_is_bot then/);
  assert.match(migration, /interval '15 seconds'/);
  assert.match(migration, /interval '30 seconds'/);
  assert.match(migration, /\{turnDeadlineAt\}/);
  assert.match(migration, /\{turnDurationSeconds\}/);
  assert.doesNotMatch(migration, /v_timeout_count|timeoutCountsByPlayerId/);
});