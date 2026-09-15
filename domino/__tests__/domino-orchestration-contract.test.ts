import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Domino 2v2 keeps authoritative commit and bounded bot processing", () => {
  const controller = readFileSync(
    "domino/modes/two-vs-two/controllers/domino-two-vs-two-bot-controller.ts",
    "utf8",
  );
  const worker = readFileSync("supabase/functions/process_bot_turns/index.ts", "utf8");

  assert.match(controller, /inFlightRef\.current/);
  assert.match(controller, /player\?\.bot_takeover/);
  assert.match(controller, /input\.adapter\.processBotTurn\(\)/);
  assert.match(worker, /commit_multiplayer_action/);
});

test("bot completion uses the current Domino settlement authority", () => {
  const worker = readFileSync("supabase/functions/process_bot_turns/index.ts", "utf8");

  assert.match(worker, /"domino_settle_match"/);
  assert.doesNotMatch(
    worker.slice(worker.indexOf('if (mode === "1v1"')),
    /"settle_finished_match_rewards"/,
  );
});
