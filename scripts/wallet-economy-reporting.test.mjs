import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("wallet history authenticates the caller and scopes every ledger to that user", () => {
  const source = read("supabase/functions/wallet_history/index.ts");
  assert.match(source, /authClient\.auth\.getUser\(\)/);
  assert.equal((source.match(/\.eq\("user_id", userId\)/g) ?? []).length, 3);
  assert.match(source, /signed_amount/);
  assert.match(source, /row\.reason === "prize" \? "payout"/);
});

test("treasury reporting includes only Aznif commission burns and does not credit treasury", () => {
  const source = read("admin-web/lib/treasury-report.ts");
  assert.match(source, /eq\("currency", "aznif"\).*eq\("reason", "commission_burn"\)/s);
  assert.match(source, /eq\("currency", "aznif"\).*eq\("reason", "house_commission"\)/s);
  assert.match(source, /treasury_delta: 0/);
  assert.match(source, /burnedTotal: Number\(treasury\.burnedTotal/);
  assert.doesNotMatch(source, /currentBalance:/);
});

test("wallet transaction types cover the types currently emitted by Remote", () => {
  const source = read("types/wallet.ts");
  for (const type of [
    "admin_aznif_debit", "admin_treasury_sync", "bet_burn", "bet_loss",
    "bet_win", "daily_quest_reward", "reward", "transfer",
  ]) assert.match(source, new RegExp(`\\| "${type}"`));
});
