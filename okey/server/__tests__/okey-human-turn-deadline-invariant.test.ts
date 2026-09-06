import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "supabase/migrations/20260906024500_okey_engine_owned_turn_deadline_invariant.sql";

test("database validates engine-owned Okey deadlines without recalculating them", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(migration, /create or replace function okey\.enforce_authoritative_turn_deadline\(\)/);
  assert.match(migration, /okey_deadline_required_for_human_turn/);
  assert.match(migration, /okey_deadline_forbidden_for_non_human_turn/);
  assert.match(migration, /okey_projection_deadline_mismatch/);
  assert.match(migration, /okey_projection_duration_mismatch/);
  assert.match(migration, /controlledByBot/);
  assert.match(migration, /eliminated/);
  assert.match(migration, /v_expected_duration := case when v_has_drawn then 30 else 15 end/);
  assert.match(migration, /before update of version on okey\.matches/);

  // The DB is a validator only. It must not become a second gameplay clock.
  assert.doesNotMatch(migration, /clock_timestamp\s*\(/);
  assert.doesNotMatch(migration, /interval\s+'15 seconds'/);
  assert.doesNotMatch(migration, /interval\s+'30 seconds'/);
  assert.doesNotMatch(migration, /new\.turn_deadline_at\s*:=/);
  assert.doesNotMatch(migration, /jsonb_set\s*\(/);
});

test("deadline guard rejects projection drift instead of rewriting projection", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(migration, /v_projection_deadline is distinct from new\.turn_deadline_at/);
  assert.match(migration, /new\.public_projection -> 'turnDeadlineAt' <> 'null'::jsonb/);
  assert.doesNotMatch(migration, /new\.public_projection\s*:=/);
});

