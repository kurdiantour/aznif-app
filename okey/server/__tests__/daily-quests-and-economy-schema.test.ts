import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/20260811000200_complete_daily_quests.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");

test("daily quest claims require authentication and enforce unique user-quest instance constraint", () => {
  assert.match(sql, /unique \(user_id, quest_instance_id\)/);
  assert.match(sql, /if v_user_id is null then raise exception 'authentication_required'/);
  assert.match(sql, /grant execute on function public\.claim_daily_quest_reward\(uuid\) to authenticated/);
  assert.match(sql, /revoke all on function public\.claim_daily_quest_reward\(uuid\) from public, anon/);
});

test("daily quest claims lock instance, progress, and wallet for update", () => {
  assert.match(sql, /for update of instance/);
  assert.match(sql, /for update/);
  assert.match(sql, /daily_quest_reward_claims/);
  assert.match(sql, /alreadyclaimed/);
});

test("daily quest claims record wallet transaction audit logs atomically", () => {
  assert.match(sql, /insert into public\.wallet_transactions/);
  assert.match(sql, /daily_quest_reward/);
  assert.match(sql, /balance_before/);
  assert.match(sql, /balance_after/);
});
