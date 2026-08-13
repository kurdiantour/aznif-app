import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260813000400_okey_membership_release.sql",
  "utf8",
);
const roomGateway = readFileSync("supabase/functions/okey_room/index.ts", "utf8");
const rewards = readFileSync(
  "supabase/migrations/20260813000300_okey_runtime_integrity.sql",
  "utf8",
);

test("takeover release is atomic with the authoritative command and preserves the seat", () => {
  assert.match(migration, /okey_commit_authoritative_command_with_events/);
  assert.match(migration, /controlledByBot.*?false[\s\S]*controlledByBot.*?true/);
  assert.match(migration, /membership_release_reason = 'bot_takeover'/);
  assert.doesNotMatch(migration, /delete from okey\.match_seats[\s\S]{0,200}bot_takeover/);
});

test("manual leave and takeover use distinct membership reasons", () => {
  assert.match(migration, /p_command_type = 'manual-leave'/);
  assert.match(migration, /'manual_leave'/);
  assert.match(migration, /'bot_takeover'/);
  assert.doesNotMatch(migration, /manualLeftPlayerIds[\s\S]{0,200}bot_takeover/);
});

test("active membership, matchmaking and reconnect use released membership state", () => {
  assert.match(migration, /get_active_okey_memberships[\s\S]*membership_released_at is null/);
  assert.match(migration, /where seat\.user_id = p_user_id AND seat\.membership_released_at IS NULL/i);
  assert.match(migration, /raise exception 'membership_released'/);
  assert.match(roomGateway, /membership_released_at/);
});

test("released membership blocks new human authoritative access but permits idempotent retry", () => {
  assert.match(migration, /seat\.membership_released_at is null[\s\S]*or exists[\s\S]*command\.command_id = p_command_id/);
});

test("bot takeover does not enter the manual-leave reward penalty input", () => {
  assert.match(rewards, /state->'manualLeftPlayerIds'/);
  assert.doesNotMatch(rewards, /membership_release_reason|bot_takeover/);
});
