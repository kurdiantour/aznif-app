import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/20260811000600_release_party_presence_on_cancel.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");

test("either authenticated party member can call the shared cancel RPC", () => {
  assert.match(sql, /join public\.domino_party_members pm on pm\.party_id = p\.id/);
  assert.match(sql, /where pm\.user_id = v_uid and p\.status = 'active'/);
  assert.doesNotMatch(sql, /party_leader_required/);
  assert.match(sql, /grant execute on function public\.cancel_game_party\(\) to authenticated/);
});

test("party cancellation is idempotent and releases both members", () => {
  assert.match(sql, /if not found then return jsonb_build_object\('status', 'already_cancelled'\)/);
  assert.match(sql, /set status = 'disbanded'/);
  assert.match(sql, /delete from public\.domino_party_members where party_id = v_party\.id/);
});

test("cancellation clears shared follow state, pending invites, and both queues", () => {
  assert.match(sql, /flow_status = 'idle'/);
  assert.match(sql, /current_game = null/);
  assert.match(sql, /current_room_id = null/);
  assert.match(sql, /current_table_id = null/);
  assert.match(sql, /command_version = command_version \+ 1/);
  assert.match(sql, /update public\.two_vs_two_matchmaking_queue/);
  assert.match(sql, /delete from okey\.match_seats/);
  assert.match(sql, /party_id = v_party\.id and status = 'accepted'/);
  assert.match(sql, /status = 'pending'/);
  assert.match(sql, /update public\.user_presence set status = 'online_available'/);
  assert.match(sql, /m\.status in \('waiting', 'cancelled'\)/);
});

