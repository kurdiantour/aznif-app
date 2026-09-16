import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Okey Realtime broadcasts carry projections and only gaps fetch snapshots", () => {
  const edge = read("supabase/functions/okey_match/index.ts");
  const maintenance = read("supabase/functions/okey_maintenance/index.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");

  for (const broadcaster of [edge, maintenance, reconciler]) {
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
  assert.ok(hook.includes("applySnapshot(next)"));
});


test("Okey bot execution is 100% server-owned with exact-match and idempotency", () => {
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");
  const executor = read("okey/server/okey-bot-executor.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");
  const engine = read("okey/server/okey-turn-engine.ts");

  // Client does not trigger bots:
  assert.doesNotMatch(adapter, /processBotTurn/);
  assert.doesNotMatch(hook, /selectBotTurn/);
  assert.doesNotMatch(hook, /canExecuteBotTurn/);

  // Server reconciles and executes:
  assert.match(reconciler, /reconcileAuthoritativeServerLifecycleAlarm/);
  assert.match(worker, /reconcileAuthoritativeServerLifecycleAlarm\(\{/);
  assert.doesNotMatch(worker, /chooseBotDrawSource|prepareBotTurn|settleAuthoritativeOkeyRound/);
  assert.match(executor, /selectOkeyBotIntent/);
  assert.match(engine, /system-bot-\$\{intent\.step\}/);
  assert.match(reconciler, /evaluateOkeyServerLifecycle/);
  assert.match(executor, /step === "draw"[\s\S]*drawTile/);
  assert.match(executor, /prepareBotTurn/);
  assert.match(engine, /committed\.rejectionReason \?\? "already_processed"/);
  assert.match(engine, /rejectionReason: "stale_bot_controller"/);

  assert.doesNotMatch(executor, /dispatchContinuation|scheduleLifecycleAlarm/);
});

test("Okey timeout execution is 100% server-owned without client triggers", () => {
  const edge = read("supabase/functions/okey_match/index.ts");
  const maintenance = read("supabase/functions/okey_maintenance/index.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");
  const engine = read("okey/server/okey-turn-engine.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");

  // Server reconciles timeouts:
  assert.match(reconciler, /reconcileAuthoritativeServerLifecycleAlarm/);
  assert.match(engine, /executeOkeyAuthoritativePipeline/);
  assert.match(engine, /type: "timeout"/);
  assert.match(engine, /OKEY_AUTHORITATIVE_TRANSITION_REDUCERS/);
  assert.doesNotMatch(reconciler, /resolveAuthoritativeMatchDeadline\(/);
  assert.match(edge, /reconcileAuthoritativeHumanCommand/);
  assert.doesNotMatch(edge, /reconcileAuthoritativeServerLifecycleAlarm/);
  assert.doesNotMatch(maintenance, /reconcileAuthoritativeServerLifecycleAlarm|\.eq\("status", "playing"\)/);

  // Client does NOT trigger or advance timeouts:
  assert.doesNotMatch(adapter, /resolveTimeout/);
  assert.doesNotMatch(adapter, /OkeyTurnTimeoutClaim/);
  assert.doesNotMatch(hook, /canClaimTimeout/);
  assert.doesNotMatch(hook, /getTimeoutError/);
  assert.doesNotMatch(edge, /action === "resolve-timeout"/);

  // Visual countdown still provided from direct hook:
  assert.match(hook, /turnTimeLeft:/);
});

test("Okey maintenance settles finished matches while gameplay remains worker-owned", () => {
  const maintenance = read("supabase/functions/okey_maintenance/index.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");

  assert.match(maintenance, /state_update/);
  assert.doesNotMatch(maintenance, /reconcileAuthoritativeServerLifecycleAlarm|\.eq\("status", "playing"\)/);
  assert.match(maintenance, /x-aznif-lifecycle-key/);
  assert.match(maintenance, /\.eq\("status", "finished"\)[\s\S]*settlement_at/);
  assert.match(worker, /if \(!isTrustedWorker\)\s*\{[\s\S]*return json\(\{ error: "Unauthorized" \}, 401\);[\s\S]*\}/);
  assert.match(worker, /reconcileAuthoritativeServerLifecycleAlarm/);
});

test("Okey eliminated turns are 100% server-owned through reconciler without client triggers", () => {
  const edge = read("supabase/functions/okey_match/index.ts");
  const maintenance = read("supabase/functions/okey_maintenance/index.ts");
  const bot = read("okey/server/okey-bot-executor.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");
  const engine = read("okey/server/okey-turn-engine.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");
  const matchAdapterInterface = read("okey/adapters/okey-match-adapter.ts");

  // Server owners:
  assert.match(edge, /reconcileAuthoritativeHumanCommand/);
  assert.doesNotMatch(edge, /reconcileAuthoritativeServerLifecycleAlarm/);
  assert.doesNotMatch(maintenance, /reconcileAuthoritativeServerLifecycleAlarm|\.eq\("status", "playing"\)/);
  assert.doesNotMatch(bot, /reconcileAuthoritativeEliminatedTurns/);
  assert.match(engine, /executeOkeyAuthoritativePipeline/);
  assert.match(engine, /type: "eliminated-turn"/);
  assert.match(engine, /OKEY_AUTHORITATIVE_TRANSITION_REDUCERS/);
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
  const engine = read("okey/server/okey-turn-engine.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");
  const matchInterface = read("okey/adapters/okey-match-adapter.ts");

  // Server reconciler owns next round and room match start:
  assert.match(reconciler, /reconcileAuthoritativeServerLifecycleAlarm/);
  assert.match(reconciler, /reconcileAuthoritativeMatchStart/);
  assert.match(engine, /executeOkeyAuthoritativePipeline/);
  assert.match(engine, /type: "next-round"/);
  assert.match(engine, /OKEY_AUTHORITATIVE_TRANSITION_REDUCERS/);
  assert.doesNotMatch(reconciler, /startAuthoritativeOkeyNextRound\(/);
  assert.match(reconciler, /createAuthoritativeOkeyMatch/);

  // Client does NOT have triggers or endpoints:
  assert.doesNotMatch(adapter, /startNextRound/);
  assert.doesNotMatch(adapter, /OkeyNextRoundClaim/);
  assert.doesNotMatch(matchInterface, /startNextRound/);
  assert.doesNotMatch(matchInterface, /OkeyNextRoundClaim/);
  assert.doesNotMatch(edge, /action === "start-next-round"/);
});

