import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const presence = readFileSync("lib/presence.tsx", "utf8");
const okeyRoom = readFileSync("supabase/functions/okey_room/index.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260827162248_extend_global_presence_freshness.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");

test("global DB presence uses a 60 second heartbeat and 120 second freshness", () => {
  assert.match(presence, /const ONLINE_WINDOW_MS = 120_000;/);
  assert.match(presence, /const heartbeat = setInterval\([\s\S]*?60_000,/);
  assert.match(presence, /AppState\.addEventListener\([\s\S]*?publishPresence/);
});

test("invite and Domino party RPCs share the 120 second freshness contract", () => {
  for (const signature of [
    "public.send_game_invite(uuid)",
    "public.respond_game_invite(uuid,boolean)",
    "public.find_domino_match(text,text,numeric)",
  ]) {
    assert.match(migration, new RegExp(signature.replace(/[().]/g, "\\$&")));
  }
  assert.match(migration, /replace\(v_definition, '35 seconds', '120 seconds'\)/);
});

test("Okey party eligibility uses the same 120 second freshness", () => {
  assert.match(okeyRoom, /const cutoff = Date\.now\(\) - 120_000;/);
});