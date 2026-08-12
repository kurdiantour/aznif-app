import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const disconnectSql = readFileSync(
  "supabase/migrations/20260630000500_reliable_disconnect_bot_takeover.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");

const roomScopedSql = readFileSync(
  "supabase/migrations/20260630000600_scope_disconnect_takeover_to_room.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");

const forfeit2v2Sql = readFileSync(
  "supabase/migrations/20260809000200_domino_two_vs_two_atomic_leave_forfeit.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");

const noHumans1v1Sql = readFileSync(
  "supabase/migrations/20260809000400_domino_one_vs_one_no_humans_finish.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");

test("domino disconnect takeover requires 60s grace period and service_role execute", () => {
  assert.match(disconnectSql, /greatest\(p_grace_seconds, 60\)/);
  assert.match(disconnectSql, /set connected = false/);
  assert.match(disconnectSql, /bot_takeover = true/);
  assert.match(disconnectSql, /takeover_started/);
  assert.match(disconnectSql, /grant execute on function public\.process_one_vs_one_takeovers\(integer\) to service_role/);
  assert.match(disconnectSql, /grant execute on function public\.process_two_vs_two_takeovers\(integer\) to service_role/);
});

test("room-scoped takeover acquires advisory lock on room id and synchronizes move sequence", () => {
  assert.match(roomScopedSql, /perform pg_advisory_xact_lock\(hashtextextended\(p_room_id::text,31\)\)/);
  assert.match(roomScopedSql, /max\(move\.sequence\)/);
});

test("manual leave in domino 2v2 causes immediate atomic team forfeit", () => {
  assert.match(forfeit2v2Sql, /settle_free_two_vs_two_manual_forfeit/);
  assert.match(forfeit2v2Sql, /forfeit/);
  assert.match(forfeit2v2Sql, /match_reward_records/);
});

test("domino 1v1 terminates when zero humans remain", () => {
  assert.match(noHumans1v1Sql, /status = 'finished'/);
});
