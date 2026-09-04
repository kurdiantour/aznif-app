import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/20260813000300_okey_runtime_integrity.sql",
  "utf8",
)
  .toLowerCase()
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ");

const botFunction = readFileSync(
  "supabase/functions/process_bot_turns/index.ts",
  "utf8",
);

test("runtime migration restores idempotent Okey Fun rewards", () => {
  assert.match(sql, /create table if not exists okey\.fun_match_rewards/);
  assert.match(sql, /primary key \(match_id, user_id\)/);
  assert.match(sql, /create trigger okey_apply_fun_match_rewards/);
  assert.match(sql, /state->'manualleftplayerids'/);
  assert.match(sql, /set gem = gem \+ v_gem_delta/);
});

test("runtime migration restores the cancellation refund used by okey_room", () => {
  assert.match(sql, /function public\.okey_cancel_match_and_refund/);
  assert.match(sql, /reason = 'entry_fee'/);
  assert.match(sql, /mc = mc \+ v_refund_amount/);
  assert.match(sql, /coin = coin \+ v_refund_amount/);
  assert.match(sql, /if v_match\.settlement_at is not null/);
  assert.match(sql, /p_match_id::text \|\| ':refund:'/);
});

test("bot completion uses the current Domino settlement authority", () => {
  assert.match(botFunction, /"domino_settle_match"/);
  assert.doesNotMatch(
    botFunction.slice(botFunction.indexOf('if (mode === "1v1"')),
    /"settle_finished_match_rewards"/,
  );
});