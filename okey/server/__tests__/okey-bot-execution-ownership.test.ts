import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Okey Bot execution is 100% server-owned through reconciler with zero client triggers", () => {
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const matchAdapter = read("okey/adapters/okey-multiplayer-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");
  const executor = read("okey/server/okey-bot-executor.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");
  const edge = read("supabase/functions/okey_match/index.ts");
  const maintenance = read("supabase/functions/okey_maintenance/index.ts");
  const matchAdapterInterface = read("okey/adapters/okey-match-adapter.ts");

  // Client must NOT have any bot triggers or claims:
  assert.doesNotMatch(adapter, /processBotTurn/);
  assert.doesNotMatch(matchAdapterInterface, /processBotTurn/);
  assert.doesNotMatch(matchAdapter, /async executeBotTurn/);
  assert.doesNotMatch(hook, /selectBotTurn/);
  assert.doesNotMatch(hook, /canExecuteBotTurn/);

  // Server owns bot execution through reconciler and executor:
  assert.match(reconciler, /reconcileAuthoritativeServerTurns/);
  assert.match(edge, /reconcileAuthoritativeServerTurns/);
  assert.doesNotMatch(maintenance, /reconcileAuthoritativeServerTurns|\.eq\("status", "playing"\)/);
  assert.match(maintenance, /\.eq\("status", "finished"\)[\s\S]*settlement_at/);
  assert.match(worker, /if \(!isTrustedWorker\)\s*\{[\s\S]*return json\(\{ error: "Unauthorized" \}, 401\);[\s\S]*\}/);
  assert.match(executor, /executeOkeyBotTurn/);
  assert.match(executor, /classifyBotTurnClaim/);
  assert.match(executor, /p_expected_version: currentVersion/);
});

