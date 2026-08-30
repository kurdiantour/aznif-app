import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Okey Bot execution is server-owned and bound to the observed version and actor", () => {
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyGame.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");
  const executor = read("okey/server/okey-bot-executor.ts");

  assert.doesNotMatch(adapter, /processBotTurn|process_bot_turns/);
  assert.doesNotMatch(hook, /useOkeyMultiplayerBotController/);
  assert.match(worker, /handOffBotTurn:[\s\S]*handOffOkeyBotTurn/);
  assert.match(executor, /classifyBotTurnClaim/);
  assert.match(executor, /currentActorId: currentPlayer\?\.id/);
  assert.match(executor, /reason: "stale_bot_turn"/);
  assert.match(executor, /p_expected_version: currentVersion/);
  assert.doesNotMatch(executor, /while \(true\)/);
});