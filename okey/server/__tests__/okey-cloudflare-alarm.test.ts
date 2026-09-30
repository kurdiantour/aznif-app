import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scheduler = readFileSync(
  "cloudflare/aznif-game-lifecycle/src/index.js",
  "utf8",
);
const worker = readFileSync("supabase/functions/process_bot_turns/index.ts", "utf8");
const engine = readFileSync("okey/server/okey-turn-engine.ts", "utf8");

test("Cloudflare stores only match id, expected version, and official run time", () => {
  assert.match(scheduler, /return \{ gameType, matchId, expectedVersion, runAt \}/);
  assert.match(scheduler, /`\$\{lifecycleJob\.gameType\}:\$\{lifecycleJob\.matchId\}`/);
  assert.match(scheduler, /storage\.put\(JOB_KEY, lifecycleJob\)/);
  assert.match(scheduler, /storage\.setAlarm\(Date\.parse\(lifecycleJob\.runAt\)\)/);
  assert.doesNotMatch(scheduler, /gameState|roundState|turn_deadline_at/);
});

test("lifecycle alarm is version-bound, one-shot, and contains no waiting loop", () => {
  assert.match(scheduler, /expected_version: lifecycleJob\.expectedVersion/);
  assert.match(engine, /version !== Number\(options\.initialVersion\)/);
  assert.doesNotMatch(scheduler, /setTimeout|setInterval|sleep\(|while\s*\(/);
  assert.doesNotMatch(worker, /edgeRuntime\.waitUntil\(lifecyclePromise\)/);
});
