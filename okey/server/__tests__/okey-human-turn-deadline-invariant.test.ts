import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("database deadline ownership depends on the current actor, not timeout history", () => {
  const migration = readFileSync(
    "supabase/migrations/20260823124603_okey_human_turn_deadline_invariant.sql",
    "utf8",
  );

  assert.match(migration, /if v_player_is_bot then/);
  assert.match(migration, /clock_timestamp\(\) \+ interval '30 seconds'/);
  assert.match(migration, /\{turnDeadlineAt\}/);
  assert.doesNotMatch(migration, /v_timeout_count|timeoutCountsByPlayerId/);
});
