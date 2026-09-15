import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20260813000400_okey_membership_release.sql", "utf8")
  .toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
const gateway = readFileSync("supabase/functions/okey_room/index.ts", "utf8");

test("Okey Party reserves one complete team pair atomically", () => {
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('okey-matchmaking:'/);
  assert.match(sql, /player_index in\(0,2\)/);
  assert.match(sql, /player_index in\(1,3\)/);
  assert.match(sql, /values\s*\(v_match\.id,p_leader_id,v_first/);
  assert.match(sql, /\(v_match\.id,p_member_id,v_second/);
});

test("Party allocation and follow state commit in the same transaction", () => {
  assert.match(sql, /update public\.domino_parties set flow_status='matchmaking'/);
  assert.match(sql, /party_member_already_in_match/);
  assert.match(sql, /if auth\.role\(\)<>'service_role' then raise exception 'service_role_required'/);
  assert.match(gateway, /service\.rpc\("matchmake_okey_party"/);
  assert.doesNotMatch(gateway, /service\.rpc\("align_okey_party_teammates"/);
});


