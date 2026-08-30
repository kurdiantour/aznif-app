import assert from "node:assert/strict";
import test from "node:test";

import {
  BotTurnClaimRegistry,
  classifyBotTurnClaim,
  createBotTurnClaim,
} from "../../../lib/multiplayer/core/bot-turn-orchestration.ts";
import {
  createBotTakeoverTransition,
  projectSeatOwnership,
} from "../../../lib/multiplayer/core/seat-ownership.ts";
import {
  advanceConsecutiveTimeout,
  classifyTimeoutResult,
  createTimeoutClaim,
  getTimeoutClaimKey,
  resetConsecutiveTimeout,
} from "../../../lib/multiplayer/core/timeout-orchestration.ts";

test("shared ownership preserves the original owner and distinguishes takeover reasons", () => {
  const ownership = projectSeatOwnership({
    seatId: "seat-1",
    ownerPlayerId: "player-1",
    controlledByBot: false,
  });
  assert.deepEqual(createBotTakeoverTransition(ownership, "manual_leave"), {
    seatId: "seat-1",
    ownerPlayerId: "player-1",
    controller: "human",
    from: "human",
    to: "bot",
    reason: "manual_leave",
  });
  assert.equal(createBotTakeoverTransition({ ...ownership, controller: "bot" }, "timeout"), null);
});

test("shared timeout streak reaches the configured Okey threshold and resets", () => {
  const first = advanceConsecutiveTimeout(0, 2);
  const second = advanceConsecutiveTimeout(first.streak, 2);
  assert.deepEqual(first, { streak: 1, shouldTakeOver: false });
  assert.deepEqual(second, { streak: 2, shouldTakeOver: true });
  assert.equal(resetConsecutiveTimeout(), 0);
});

test("shared timeout claims and server results have stable normalized identities", () => {
  const claim = createTimeoutClaim({
    expectedVersion: 4,
    expectedTurnDeadlineAt: "2026-08-30T10:00:00.000Z",
    expectedTurnPlayerId: "player-1",
  });
  assert.ok(claim);
  assert.equal(getTimeoutClaimKey(claim), "4:2026-08-30T10:00:00.000Z:player-1");
  assert.equal(classifyTimeoutResult({ code: "turn_timer_not_expired" }), "retry_at_deadline");
  assert.equal(classifyTimeoutResult({ code: "already_processed" }), "already_processed");
  assert.equal(classifyTimeoutResult({ code: "stale_timeout" }), "stale");
});

test("shared Bot claims reject stale actors and prevent duplicate in-flight execution", () => {
  const ownership = projectSeatOwnership({
    seatId: "seat-1",
    ownerPlayerId: "player-1",
    controlledByBot: true,
  });
  const claim = createBotTurnClaim({ version: 8, actorId: "player-1", ownership });
  assert.ok(claim);
  assert.equal(classifyBotTurnClaim({ claim, currentVersion: 9, currentActorId: "player-1", currentOwnership: ownership }), "already_processed");
  assert.equal(classifyBotTurnClaim({ claim, currentVersion: 8, currentActorId: "player-2", currentOwnership: ownership }), "stale");

  const registry = new BotTurnClaimRegistry();
  const key = registry.tryAcquire("match-1", claim);
  assert.ok(key);
  assert.equal(registry.tryAcquire("match-1", claim), null);
  registry.release(key);
  assert.equal(registry.tryAcquire("match-1", claim), key);
});
