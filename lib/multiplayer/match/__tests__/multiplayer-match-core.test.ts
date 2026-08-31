import assert from "node:assert/strict";
import test from "node:test";
import { createTurnTimeoutClaim, deriveMatchPhase, getTurnIdentity, projectDeadlineMs } from "../lifecycle.ts";
import { MultiplayerSnapshotStore } from "../snapshot-store.ts";
import type { MultiplayerLifecycle } from "../contracts.ts";

const lifecycle = (overrides: Partial<MultiplayerLifecycle> = {}): MultiplayerLifecycle => ({
  status: "playing",
  version: 4,
  roundId: "round-1",
  completedRoundId: null,
  turnPlayerId: "player-1",
  turnDeadlineAt: "2026-08-31T12:00:30.000Z",
  roundFinished: false,
  matchFinished: false,
  ...overrides,
});

test("lifecycle prioritizes terminal match and cancellation states", () => {
  assert.equal(deriveMatchPhase(lifecycle({ roundFinished: true })), "round_result");
  assert.equal(deriveMatchPhase(lifecycle({ roundFinished: true, matchFinished: true })), "match_finished");
  assert.equal(deriveMatchPhase(lifecycle({ status: "cancelled", matchFinished: true })), "cancelled");
});

test("timeout claim is versioned and bound to the authoritative turn", () => {
  const claim = createTurnTimeoutClaim(lifecycle());
  assert.deepEqual(claim, {
    expectedVersion: 4,
    expectedTurnDeadlineAt: "2026-08-31T12:00:30.000Z",
    expectedTurnPlayerId: "player-1",
  });
  assert.equal(getTurnIdentity(claim!), "4:2026-08-31T12:00:30.000Z:player-1");
  assert.equal(createTurnTimeoutClaim(lifecycle({ roundFinished: true })), null);
});

test("deadline projection uses server clock offset", () => {
  assert.equal(projectDeadlineMs("2026-08-31T12:00:30.000Z", 5_000, Date.parse("2026-08-31T12:00:20.000Z")), 5_000);
});

test("snapshot store rejects stale and malformed versions", () => {
  type Snapshot = { lifecycle: MultiplayerLifecycle; value: string };
  const store = new MultiplayerSnapshotStore<Snapshot>((value) => value.lifecycle);
  assert.equal(store.apply({ lifecycle: lifecycle({ version: 2 }), value: "new" }), true);
  assert.equal(store.apply({ lifecycle: lifecycle({ version: 1 }), value: "stale" }), false);
  assert.equal(store.getSnapshot()?.value, "new");
  assert.equal(store.apply({ lifecycle: lifecycle({ version: Number.NaN }), value: "bad" }), false);
});
