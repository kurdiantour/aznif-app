import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const baseSql = readFileSync(
  "supabase/okey/migrations/20260802000100_okey_authoritative_core.sql",
  "utf8",
).toLowerCase();
const sql = readFileSync(
  "supabase/okey/migrations/20260802000200_okey_multiplayer_rooms.sql",
  "utf8",
).toLowerCase();
const roomFunction = readFileSync("supabase/functions/okey_room/index.ts", "utf8");
const matchFunction = readFileSync("supabase/functions/okey_match/index.ts", "utf8");

test("multiplayer migration remains Okey-only", () => {
  assert.match(sql, /alter table okey\.matches/);
  assert.match(sql, /alter table okey\.match_seats/);
  assert.doesNotMatch(sql, /one_vs_one|two_vs_two|domino/);
});

test("matchmaking serializes seat assignment and caps rooms at four", () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /generate_series\(0, 3\)/);
  assert.match(sql, /count\(\*\)[^;]+< 4/s);
  assert.match(baseSql, /unique \(match_id, player_index\)/);
});

test("four connected seats start only after the server countdown", () => {
  assert.match(sql, /interval '5 seconds'/);
  assert.match(sql, /v_member_count <> 4 or v_connected_count <> 4/);
  assert.match(sql, /countdown_deadline_at > now\(\)/);
  assert.match(sql, /last_seen_at >= v_match\.countdown_deadline_at/);
  assert.match(sql, /v_confirmed_count <> 4/);
  assert.match(sql, /insert into okey\.match_private_states/);
});

test("disconnect or leave cancels the countdown", () => {
  assert.match(sql, /last_seen_at < now\(\) - interval '4 seconds'/);
  assert.match(sql, /set countdown_deadline_at = null/);
  assert.doesNotMatch(sql, /\bready\b|ready_count/);
});

test("room gateway is service-role only and supports reconnect", () => {
  assert.match(sql, /auth\.role\(\) <> 'service_role'/);
  assert.match(sql, /revoke all on function public\.okey_room_action[^;]+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.okey_room_action[^;]+to service_role/);
  assert.match(sql, /reconnect/);
});

test("Realtime carries invalidation only, never authoritative state", () => {
  assert.match(roomFunction, /event: "invalidate"/);
  assert.match(matchFunction, /event: "invalidate"/);
  assert.doesNotMatch(roomFunction, /payload:\s*\{[^}]*state/s);
  assert.doesNotMatch(matchFunction, /payload:\s*\{[^}]*state/s);
});
