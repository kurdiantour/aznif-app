import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scheduler = readFileSync(
  "cloudflare/aznif-game-lifecycle/src/index.js",
  "utf8",
);
const worker = readFileSync("supabase/functions/process_bot_turns/index.ts", "utf8");
const reconciler = readFileSync("okey/server/okey-server-reconciler.ts", "utf8");

test("Cloudflare stores only match id, expected version, and official run time", () => {
  assert.match(scheduler, /return \{ gameType, matchId, expectedVersion, runAt \}/);
  assert.match(scheduler, /`\$\{wakeup\.gameType\}:\$\{wakeup\.matchId\}`/);
  assert.match(scheduler, /storage\.put\(JOB_KEY, wakeup\)/);
  assert.match(scheduler, /storage\.setAlarm\(Date\.parse\(wakeup\.runAt\)\)/);
  assert.doesNotMatch(scheduler, /gameState|roundState|turn_deadline_at/);
});

test("alarm wake-up is version-bound, one-shot, and contains no waiting loop", () => {
  assert.match(scheduler, /expected_version: wakeup\.expectedVersion/);
  assert.match(reconciler, /version !== Number\(options\.initialVersion\)/);
  assert.match(reconciler, /maxTransitions: options\.maxTransitions \?\? 1/);
  assert.doesNotMatch(scheduler, /setTimeout|setInterval|sleep\(|while\s*\(/);
  assert.doesNotMatch(worker, /edgeRuntime\.waitUntil\(lifecyclePromise\)/);
});
