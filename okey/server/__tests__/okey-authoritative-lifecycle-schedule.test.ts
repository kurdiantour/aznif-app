import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("authoritative lifecycle schedule carries exactly version and official time", () => {
  const scheduler = readFileSync("supabase/functions/_shared/aznif-game-lifecycle.ts", "utf8");
  assert.match(scheduler, /matchId: input\.matchId/);
  assert.match(scheduler, /expectedVersion: input\.expectedVersion/);
  assert.match(scheduler, /runAt/);
  assert.doesNotMatch(scheduler, /expectedActorId|roundState|animation/);
});

test("external and Bot commits use one-step exact claims while maintenance stays settlement-only", () => {
  const worker = readFileSync("supabase/functions/process_bot_turns/index.ts", "utf8");
  const maintenance = readFileSync("supabase/functions/okey_maintenance/index.ts", "utf8");
  const scheduler = readFileSync("supabase/functions/_shared/aznif-game-lifecycle.ts", "utf8");

  assert.match(worker, /\.is\("membership_released_at", null\)/);
  assert.match(maintenance, /\.eq\("status", "finished"\)/);
  assert.match(maintenance, /\.is\("settlement_at", null\)/);
  assert.doesNotMatch(maintenance, /reconcileAuthoritativeServerLifecycleAlarm|\.eq\("status", "playing"\)/);
  assert.match(scheduler, /expectedVersion: input\.expectedVersion/);
  assert.match(scheduler, /schedulerUrl/);
  assert.doesNotMatch(scheduler, /while\s*\(|setInterval|setTimeout/);
});
