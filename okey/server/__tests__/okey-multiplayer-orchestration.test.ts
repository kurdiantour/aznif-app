import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

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
  const controller = read("okey/controllers/okey-multiplayer-bot-controller.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");

  assert.match(controller, /inFlightTurnKeysRef\.current/);
  assert.match(controller, /player\?\.controlledByBot/);
  assert.match(worker, /processOkeyBotTurn\([\s\S]*claimedVersion: number,[\s\S]*claimedActorId: string/);
  assert.doesNotMatch(worker, /while \(true\)/);
  assert.match(worker, /system-bot-\$\{botStep\}:\$\{expectedVersion\}/);
  assert.match(worker, /hasDrawnThisTurn[\s\S]*\? "discard"[\s\S]*: "draw"/);
  assert.match(worker, /botStep === "draw"[\s\S]*drawTile[\s\S]*playBotTurn/);
  assert.match(worker, /reason: "already_processed"/);
  assert.match(worker, /reason: "stale_bot_controller"/);
  assert.match(worker, /currentPlayer\.controlledByBot/);
  assert.doesNotMatch(worker, /handOffOkeyBotTurn/);
  assert.doesNotMatch(worker, /successor Bot handoff/);
});

test("Okey timeout claims remain current-player-only and exact-version", () => {
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const timeoutController = read("okey/hooks/useOkeyTimeoutController.ts");
  const publish = adapter.slice(
    adapter.indexOf("private publish("),
    adapter.indexOf("private openRealtimeChannel"),
  );

  assert.doesNotMatch(publish, /scheduleTimeout/);
  assert.match(timeoutController, /currentUserId !== claim\.expectedTurnPlayerId/);
  assert.match(timeoutController, /expectedVersion/);
  assert.match(timeoutController, /expectedTurnDeadlineAt/);
  assert.match(timeoutController, /expectedTurnPlayerId/);
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
  const hook = read("okey/hooks/useOkeyGame.ts");
  const server = read("okey/server/okey-authoritative.ts");

  assert.match(edge, /action === "play-eliminated"/);
  assert.match(edge, /applyAuthoritativeOkeyEliminatedTurn/);
  assert.match(edge, /expectedActorId/);
  assert.match(edge, /clientExpectedVersion/);
  assert.match(edge, /system-eliminated-turn/);
  assert.match(adapter, /playEliminatedTurn/);
  assert.match(hook, /eliminatedTurnClaimRef/);
  assert.match(server, /player\.eliminated[\s\S]*return null/);
  assert.doesNotMatch(
    edge.slice(edge.indexOf('action === "play-eliminated"'), edge.indexOf('action === "manual-leave"')),
    /resolveAuthoritativeMatchDeadline|process_bot_turns/,
  );
});
