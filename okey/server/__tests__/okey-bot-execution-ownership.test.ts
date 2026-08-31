import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Okey Bot execution is server-owned and bound to the observed version and actor", () => {
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const matchAdapter = read("okey/adapters/okey-multiplayer-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");
  const core = read("lib/multiplayer/match/use-multiplayer-match.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");
  const executor = read("okey/server/okey-bot-executor.ts");

  assert.ok(adapter.includes("processBotTurn") || adapter.includes("process_bot_turns"));
  const executeBotTurn =
    matchAdapter.split("async executeBotTurn")[1]?.split("async startNextRound")[0] ?? "";
  assert.ok(executeBotTurn.includes("processBotTurn(claim)"));
  assert.ok(!executeBotTurn.includes("refresh()"));
  const coreBotExecution =
    core.split("executeBotTurn!(claim)")[1]?.split(".catch")[0] ?? "";
  assert.ok(coreBotExecution.includes("return refresh()"));
  assert.ok(hook.includes("selectBotTurn: selectOkeyBotTurn"));
  assert.ok(core.includes("BotTurnClaimRegistry"));
  assert.ok(core.includes("executeBotTurn"));
  assert.ok(!hook.includes("useOkeyMultiplayerBotController"));
  assert.ok(worker.includes("executeOkeyBotTurn"));
  assert.ok(executor.includes("classifyBotTurnClaim"));
  assert.ok(executor.includes("currentActorId: currentPlayer?.id"));
  assert.ok(executor.includes('reason: "stale_bot_turn"'));
  assert.ok(executor.includes("p_expected_version: currentVersion"));
  assert.ok(!executor.includes("while (true)"));
});
