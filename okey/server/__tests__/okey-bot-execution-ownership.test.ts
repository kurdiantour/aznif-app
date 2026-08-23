import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Okey Bot execution is bound to the observed version and actor", () => {
  const controller = read("okey/controllers/okey-multiplayer-bot-controller.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");
  const okeyWorker = worker.slice(
    worker.indexOf("async function processOkeyBotTurn"),
    worker.indexOf("serve(async"),
  );

  assert.match(controller, /turnKey = `\$\{matchId\}:\$\{expectedVersion\}:\$\{player\.id\}`/);
  assert.match(controller, /inFlightTurnKeysRef\.current\.add\(turnKey\)/);
  assert.match(controller, /inFlightTurnKeysRef\.current\.delete\(turnKey\)/);
  assert.match(controller, /expectedVersion,\s*expectedActorId: player\.id/);
  assert.match(adapter, /expected_version: claim\.expectedVersion/);
  assert.match(adapter, /expected_actor_id: claim\.expectedActorId/);
  assert.match(okeyWorker, /expectedVersion !== claimedVersion/);
  assert.match(okeyWorker, /currentPlayer\?\.id !== claimedActorId/);
  assert.match(okeyWorker, /reason: "stale_bot_turn"/);
  assert.match(okeyWorker, /p_expected_version: expectedVersion/);
  assert.doesNotMatch(okeyWorker, /while \(true\)/);
});
