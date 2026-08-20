import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cleanup = readFileSync(
  "supabase/migrations/20260820130711_domino_one_vs_one_sql_contract_cleanup.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollbacks/20260820130711_domino_one_vs_one_sql_contract_cleanup.rollback.sql",
  "utf8",
);
const sourceOfTruth = readFileSync(
  "docs/domino-one-vs-one-sql-source-of-truth.md",
  "utf8",
);

test("SQL cleanup removes only the structurally verified duplicate index", () => {
  assert.match(cleanup, /duplicate\.indkey = canonical\.indkey/);
  assert.match(cleanup, /duplicate\.indpred IS NULL/);
  assert.match(cleanup, /DROP INDEX public\.idx_one_vs_one_moves_room_id_sequence/);
  assert.doesNotMatch(cleanup, /DROP (TABLE|FUNCTION|TRIGGER|POLICY)/i);
  assert.doesNotMatch(cleanup, /CREATE OR REPLACE FUNCTION/i);
  assert.match(cleanup, /ALTER FUNCTION public\.get_one_vs_one_matchmaking_status\(\)/);
  assert.match(cleanup, /USING \(user_id = \(SELECT auth\.uid\(\)\)\)/);
});

test("SQL cleanup is reversible and keeps compatibility objects", () => {
  assert.match(rollback, /CREATE INDEX IF NOT EXISTS idx_one_vs_one_moves_room_id_sequence/);
  assert.match(cleanup, /ACTIVE INTERNAL COMPATIBILITY stage used by get_one_vs_one_snapshot/);
  assert.match(cleanup, /ACTIVE COMPATIBILITY adapter to resolve_one_vs_one_terminal_round/);
  assert.match(cleanup, /LEGACY 1v1 matchmaking compatibility RPC/);
});

test("SQL source of truth protects shared modes and timeout policy", () => {
  assert.match(sourceOfTruth, /Heartbeat, presence, reconnect and disconnect have no terminal-round authority/);
  assert.match(sourceOfTruth, /shared by 1v1 and 2v2/);
  assert.match(sourceOfTruth, /must not be dropped until the snapshot body is flattened/);
  assert.match(sourceOfTruth, /Production migration history currently ends at/);
});
