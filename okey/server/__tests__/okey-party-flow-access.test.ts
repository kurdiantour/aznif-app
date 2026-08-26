import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const grants = readFileSync("supabase/migrations/20260811000800_okey_party_flow_service_access.sql", "utf8")
  .toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
const atomic = readFileSync("supabase/migrations/20260813000400_okey_membership_release.sql", "utf8")
  .toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
const gateway = readFileSync("supabase/functions/okey_room/index.ts", "utf8");

test("service access remains limited to shared Party flow columns", () => {
  assert.match(grants, /grant update \( flow_status, current_game, current_room_id, current_mode, current_currency, current_entry_fee, current_table_id, command_version, updated_at \)/);
  assert.doesNotMatch(grants, /grant (insert|delete|all)/);
});

test("seat allocation and Party follow state cannot partially commit", () => {
  assert.match(atomic, /insert into okey\.match_seats/);
  assert.match(atomic, /update public\.domino_parties set flow_status='matchmaking'/);
  assert.match(gateway, /service\.rpc\("matchmake_okey_party"/);
  assert.doesNotMatch(gateway, /partyUpdate\.error/);
});
