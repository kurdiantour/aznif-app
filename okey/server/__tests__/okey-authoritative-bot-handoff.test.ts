import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("authoritative lifecycle handoff carries exactly version and official time", () => {
  const handoff = readFileSync("supabase/functions/_shared/aznif-game-lifecycle.ts", "utf8");
  assert.match(handoff, /matchId: input\.matchId/);
  assert.match(handoff, /expectedVersion: input\.expectedVersion/);
  assert.match(handoff, /runAt/);
  assert.doesNotMatch(handoff, /expectedActorId|roundState|animation/);
});

test("external and Bot commits use one-step exact claims while maintenance stays settlement-only", () => {
  const matchGateway = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
  const worker = readFileSync("supabase/functions/process_bot_turns/index.ts", "utf8");
  const maintenance = readFileSync("supabase/functions/okey_maintenance/index.ts", "utf8");
  const handoff = readFileSync("supabase/functions/_shared/aznif-game-lifecycle.ts", "utf8");

  assert.doesNotMatch(matchGateway, /handOffOkeyBotTurn/);
  assert.doesNotMatch(worker, /handOffBotTurn:[\s\S]*handOffOkeyBotTurn/);
  assert.match(worker, /\.is\("membership_released_at", null\)/);
  assert.match(maintenance, /\.eq\("status", "finished"\)/);
  assert.match(maintenance, /\.is\("settlement_at", null\)/);
  assert.doesNotMatch(maintenance, /reconcileAuthoritativeServerTurns|\.eq\("status", "playing"\)/);
  assert.match(handoff, /expectedVersion: input\.expectedVersion/);
  assert.match(handoff, /schedulerUrl/);
  assert.doesNotMatch(handoff, /while\s*\(|setInterval|setTimeout/);
});
