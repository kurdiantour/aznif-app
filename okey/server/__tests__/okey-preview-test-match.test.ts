import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260824141125_okey_preview_test_matches.sql");
const gateway = read("supabase/functions/okey_test_match/index.ts");
const matchGateway = read("supabase/functions/okey_match/index.ts");
const worker = read("supabase/functions/process_bot_turns/index.ts");
const executor = read("okey/server/okey-bot-executor.ts");
const preview = read("app/okey/preview.tsx");

test("Okey Preview creates an admin-only real authoritative match", () => {
  assert.match(gateway, /\.select\("username, is_admin"\)/);
  assert.match(gateway, /admin_test_access_required/);
  assert.match(gateway, /createAuthoritativeOkeyMatch/);
  assert.match(gateway, /okey_create_preview_test_match/);
  assert.match(migration, /references auth\.users\(id\)/);
  assert.match(migration, /okey\.test_bot_accounts/);
  assert.match(migration, /revoke all on table okey\.test_bot_accounts from public, anon, authenticated/);
});

test("test Bot seats use the production Bot and command path", () => {
  assert.match(gateway, /controlledByBot: true/);
  assert.match(gateway, /botDifficulty: "normal"/);
  assert.match(preview, /pathname: "\/okey\/game"/);
  assert.doesNotMatch(preview, /useLocalOkeyPreviewGame/);
  assert.match(worker, /executeOkeyBotTurn/);
  assert.match(executor, /isTestMatch/);
});

test("test matches cannot change production economy or rewards", () => {
  assert.match(migration, /if new\.is_test/);
  assert.match(matchGateway, /const dailyQuestEvents = isTestMatch\s*\? \[\]/);
  assert.match(matchGateway, /economyApplied: false/);
  assert.match(executor, /economyApplied: false/);
  assert.match(migration, /entry_fee[\s\S]*0, 'fun', 0, 0, 0, 0, 0, true/);
});
