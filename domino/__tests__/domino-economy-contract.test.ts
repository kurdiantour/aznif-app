import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const client = fs.readFileSync("constants/domino-economy.ts", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/20260907000100_domino_economy_entries.sql",
  "utf8",
);

test("Domino client and backend expose only the canonical paid entries", () => {
  assert.match(client, /fun: \{ "1v1": 500, "2v2": 1_500 \}/);
  assert.match(client, /aznif: \{ "1v1": 3, "2v2": 7 \}/);
  assert.match(migration, /p_currency='fun' AND p_entry_fee=500/);
  assert.match(migration, /p_currency='fun' AND p_entry_fee=1500/);
  assert.match(migration, /p_currency='aznif' AND p_entry_fee=3/);
  assert.match(migration, /p_currency='aznif' AND p_entry_fee=7/);
  assert.doesNotMatch(migration.match(/\$new\$[\s\S]*?\$new\$/)?.[0] ?? "", /IN\s*\(/);
});

test("removed matchmaking lanes are retired by the migration", () => {
  assert.match(migration, /DELETE FROM public\.one_vs_one_matchmaking_queue/);
  assert.match(migration, /DELETE FROM public\.two_vs_two_matchmaking_queue/);
  assert.match(migration, /entry_fee IN \(5, 10\)/);
  assert.match(migration, /entry_fee IN \(15, 20\)/);
});
