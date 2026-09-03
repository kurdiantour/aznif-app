import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Okey Realtime broadcasts carry projections and only gaps fetch snapshots", () => {
  const edge = read("supabase/functions/okey_match/index.ts");
  const maintenance = read("supabase/functions/okey_maintenance/index.ts");
  const testMatch = read("supabase/functions/okey_test_match/index.ts");
  const bot = read("okey/server/okey-bot-executor.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const core = read("lib/multiplayer/match/use-multiplayer-match.ts");

  for (const broadcaster of [edge, maintenance, testMatch, bot]) {
    assert.ok(broadcaster.includes("commandId"));
    assert.ok(broadcaster.includes("publicProjection"));
    assert.ok(broadcaster.includes("actionEvents"));
    assert.ok(broadcaster.includes("version"));
  }
  assert.ok(adapter.includes("message.version <= currentVersion"));
  assert.ok(adapter.includes("message.version > currentVersion + 1"));
  assert.ok(adapter.includes("mergePublicProjection"));
  assert.ok(adapter.includes("publishActionEvents("));
  assert.ok(adapter.includes("Array.isArray(message.actionEvents)"));
  assert.ok(core.includes("onInvalidated: (publicSnapshot)"));
  assert.ok(core.includes("applySnapshot(publicSnapshot)"));
});

test("Domino 2v2 keeps authoritative commit and bounded bot processing", () => {
  const controller = read(
    "domino/modes/two-vs-two/controllers/domino-two-vs-two-bot-controller.ts",
  );
  const worker = read("supabase/functions/process_bot_turns/index.ts");

  assert.match(controller, /inFlightRef\.current/);
  assert.match(controller, /player\?\.bot_takeover/);
  assert.match(controller, /input\.adapter\.processBotTurn\(\)/);
  assert.match(worker, /commit_multiplayer_action/);
});

test("Okey bot execution is 100% server-owned with exact-match and idempotency", () => {
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");
  const executor = read("okey/server/okey-bot-executor.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");

  // Client does not trigger bots:
  assert.doesNotMatch(adapter, /processBotTurn/);
  assert.doesNotMatch(hook, /selectBotTurn/);
  assert.doesNotMatch(hook, /canExecuteBotTurn/);

  // Server reconciles and executes:
  assert.match(reconciler, /reconcileAuthoritativeServerTurns/);
  assert.match(worker, /executeOkeyBotTurn\(\{/);
  assert.doesNotMatch(worker, /chooseBotDrawSource|prepareBotTurn|settleAuthoritativeOkeyRound/);
  assert.match(executor, /createBotTurnClaim/);
  assert.match(executor, /classifyBotTurnClaim/);
  assert.match(executor, /system-bot-\$\{botStep\}:\$\{currentVersion\}/);
  assert.match(executor, /hasDrawnThisTurn \? "discard" : "draw"/);
  assert.match(executor, /botStep === "draw"[\s\S]*drawTile/);
  assert.match(executor, /prepareBotTurn/);
  assert.match(executor, /completed\("already_processed"\)/);
  assert.match(executor, /completed\("stale_bot_controller"\)/);
  assert.doesNotMatch(worker, /handOffBotTurn:[\s\S]*handOffOkeyBotTurn/);
  assert.doesNotMatch(executor, /dependencies\.handOffBotTurn/);
});

test("Okey timeout execution is 100% server-owned without client triggers", () => {
  const edge = read("supabase/functions/okey_match/index.ts");
  const maintenance = read("supabase/functions/okey_maintenance/index.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");
  const matchAdapter = read("okey/adapters/okey-multiplayer-adapter.ts");

  // Server reconciles timeouts:
  assert.match(reconciler, /reconcileAuthoritativeTimeoutTurn/);
  assert.match(reconciler, /resolveAuthoritativeMatchDeadline/);
  assert.match(edge, /reconcileAuthoritativeServerTurns/);
  assert.match(maintenance, /reconcileAuthoritativeServerTurns/);

  // Client does NOT trigger or advance timeouts:
  assert.doesNotMatch(adapter, /resolveTimeout/);
  assert.doesNotMatch(adapter, /OkeyTurnTimeoutClaim/);
  assert.doesNotMatch(matchAdapter, /async claimTimeout/);
  assert.doesNotMatch(hook, /canClaimTimeout/);
  assert.doesNotMatch(hook, /getTimeoutError/);
  assert.doesNotMatch(edge, /action === "resolve-timeout"/);

  // Visual countdown still provided from core snapshot:
  assert.match(hook, /turnTimeLeft: core\.turnSecondsLeft/);
});

test("Okey maintenance broadcasts the winning timeout commit and hands Bot turns off", () => {
  const maintenance = read("supabase/functions/okey_maintenance/index.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");

  assert.match(maintenance, /state_update/);
  assert.match(maintenance, /reconcileAuthoritativeServerTurns/);
  assert.match(maintenance, /x-okey-worker-key/);
  assert.match(maintenance, /settlement_at/);
  assert.match(worker, /if \(!isTrustedWorker\)\s*\{[\s\S]*return json\(\{ error: "Unauthorized" \}, 401\);[\s\S]*\}/);
  assert.match(worker, /\.schema\("okey"\)[\s\S]*\.from\("match_seats"\)/);
});

test("Okey eliminated turns are 100% server-owned through reconciler without client triggers", () => {
  const edge = read("supabase/functions/okey_match/index.ts");
  const maintenance = read("supabase/functions/okey_maintenance/index.ts");
  const bot = read("okey/server/okey-bot-executor.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");
  const matchAdapterInterface = read("okey/adapters/okey-match-adapter.ts");

  // Server owners:
  assert.match(edge, /reconcileAuthoritativeServerTurns/);
  assert.match(maintenance, /reconcileAuthoritativeServerTurns/);
  assert.match(bot, /reconcileAuthoritativeEliminatedTurns/);
  assert.match(reconciler, /applyAuthoritativeOkeyEliminatedTurn/);
  assert.match(reconciler, /system-eliminated-turn/);

  // Client triggers and adapter endpoints must NOT exist (Server is single owner):
  assert.doesNotMatch(hook, /eliminatedClaimRef/);
  assert.doesNotMatch(hook, /playEliminatedTurn/);
  assert.doesNotMatch(adapter, /playEliminatedTurn/);
  assert.doesNotMatch(matchAdapterInterface, /playEliminatedTurn/);
  assert.doesNotMatch(edge, /action === "play-eliminated"/);
});

test("Okey next round and match start are 100% server-owned without client triggers", () => {
  const edge = read("supabase/functions/okey_match/index.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");
  const matchInterface = read("okey/adapters/okey-match-adapter.ts");
  const matchAdapter = read("okey/adapters/okey-multiplayer-adapter.ts");

  // Server reconciler owns next round and room match start:
  assert.match(reconciler, /reconcileAuthoritativeNextRound/);
  assert.match(reconciler, /reconcileAuthoritativeMatchStart/);
  assert.match(reconciler, /startAuthoritativeOkeyNextRound/);
  assert.match(reconciler, /createAuthoritativeOkeyMatch/);

  // Client does NOT have triggers or endpoints:
  assert.doesNotMatch(adapter, /startNextRound/);
  assert.doesNotMatch(adapter, /OkeyNextRoundClaim/);
  assert.doesNotMatch(matchInterface, /startNextRound/);
  assert.doesNotMatch(matchInterface, /OkeyNextRoundClaim/);
  assert.doesNotMatch(matchAdapter, /startNextRound/);
  assert.doesNotMatch(edge, /action === "start-next-round"/);
});

