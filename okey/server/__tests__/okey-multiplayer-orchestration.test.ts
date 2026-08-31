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

test("Okey bot handoff remains exact-match, one-turn and idempotent", () => {
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");
  const core = read("lib/multiplayer/match/use-multiplayer-match.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");
  const executor = read("okey/server/okey-bot-executor.ts");

  assert.match(adapter, /processBotTurn/);
  assert.match(hook, /selectBotTurn: selectOkeyBotTurn/);
  assert.match(core, /BotTurnClaimRegistry/);
  assert.match(core, /executeBotTurn/);
  assert.match(worker, /executeOkeyBotTurn\(\{/);
  assert.doesNotMatch(worker, /chooseBotDrawSource|prepareBotTurn|settleAuthoritativeOkeyRound/);
  assert.match(executor, /createBotTurnClaim/);
  assert.match(executor, /classifyBotTurnClaim/);
  assert.match(executor, /system-bot-\$\{botStep\}:\$\{currentVersion\}/);
  assert.match(executor, /hasDrawnThisTurn \? "discard" : "draw"/);
  assert.match(executor, /botStep === "draw"[\s\S]*drawTile/);
  assert.match(executor, /prepareBotTurn/);
  assert.match(executor, /reason: "already_processed"/);
  assert.match(executor, /reason: "stale_bot_controller"/);
  assert.doesNotMatch(worker, /handOffBotTurn:[\s\S]*handOffOkeyBotTurn/);
  assert.doesNotMatch(executor, /dependencies\.handOffBotTurn/);
});

test("Okey timeout claims remain current-player-only and exact-version", () => {
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const projection = read("okey/adapters/okey-multiplayer-projection.ts");
  const publish = adapter.slice(
    adapter.indexOf("private publish("),
    adapter.indexOf("private openRealtimeChannel"),
  );

  assert.doesNotMatch(publish, /scheduleTimeout/);
  assert.match(projection, /currentUserId === claim\.expectedTurnPlayerId/);
  assert.match(adapter, /expectedVersion/);
  assert.match(adapter, /expectedTurnDeadlineAt/);
  assert.match(adapter, /expectedTurnPlayerId/);
});

test("Okey maintenance broadcasts the winning timeout commit and hands Bot turns off", () => {
  const maintenance = read("supabase/functions/okey_maintenance/index.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");

  assert.match(maintenance, /state_update/);
  assert.match(maintenance, /handOffOkeyBotTurn/);
  assert.match(maintenance, /x-okey-worker-key/);
  assert.match(maintenance, /settlement_at/);
  assert.match(worker, /if \(isTrustedWorker\)/);
  assert.match(worker, /\.schema\("okey"\)[\s\S]*\.from\("match_seats"\)/);
});

test("Okey eliminated turns use an exact-version server claim outside timeout and Bot ownership", () => {
  const edge = read("supabase/functions/okey_match/index.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const hook = read("okey/hooks/useOkeyMultiplayerGame.ts");
  const server = read("okey/server/okey-authoritative.ts");

  assert.match(edge, /action === "play-eliminated"/);
  assert.match(edge, /applyAuthoritativeOkeyEliminatedTurn/);
  assert.match(edge, /expectedActorId/);
  assert.match(edge, /clientExpectedVersion/);
  assert.match(edge, /system-eliminated-turn/);
  assert.match(adapter, /playEliminatedTurn/);
  assert.match(hook, /eliminatedClaimRef/);
  assert.match(server, /player\.eliminated[\s\S]*return null/);
  assert.doesNotMatch(
    edge.slice(edge.indexOf('action === "play-eliminated"'), edge.indexOf('action === "manual-leave"')),
    /resolveAuthoritativeMatchDeadline|process_bot_turns/,
  );
});

test("Okey startNextRound is idempotent and retries through authoritative sync", () => {
  const hook = read("lib/multiplayer/match/use-multiplayer-match.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");

  assert.match(hook, /nextRoundStartKeyRef/);
  assert.match(hook, /nextRoundStartKeyRef\.current = null/);
  assert.match(hook, /void refresh\(\)\.catch/);
  assert.match(adapter, /startNextRound[\s\S]*refreshOnError: false/);
});

