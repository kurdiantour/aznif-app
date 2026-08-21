import assert from "node:assert/strict";
import test from "node:test";

import { getSnapshotVersion, reconcileOptimisticCommand } from "@/lib/multiplayer/core/versioning";
import {
  DOMINO_ONE_VS_ONE_RULES,
  resolveBlockedHand,
  resolveEmptyHand,
  shouldOfferDraw,
} from "../engine/domino-one-vs-one-engine.ts";
import { deriveDominoOneVsOneLifecycle } from "../lifecycle/domino-one-vs-one-lifecycle.ts";

const tile = (left: number, right: number) => ({ left, right });

test("shared versioning and optimistic confirmation are monotonic", () => {
  assert.equal(getSnapshotVersion({ room: { version: 5 } }), 5);
  const pending = { id: "c1", scopeId: "m1", baseVersion: 2, payload: "x", projection: "y" };
  assert.equal(reconcileOptimisticCommand(pending, { version: 2 }, () => true).confirmed, false);
  assert.equal(reconcileOptimisticCommand(pending, { version: 3 }, () => true).confirmed, true);
});

test("production 1v1 scoring parity", () => {
  assert.deepEqual(resolveBlockedHand([[tile(1, 2)], [tile(3, 4)]]), {
    winnerIndex: 0, loserIndex: 1, remainingPips: 7, awardedPoints: 5,
  });
  assert.equal(resolveBlockedHand([[tile(1, 2)], [tile(0, 3)]]).winnerIndex, 0);
  assert.equal(resolveEmptyHand([[], [tile(6, 6), tile(1, 1)]], 0).awardedPoints, 15);
  assert.equal(DOMINO_ONE_VS_ONE_RULES.maximumHumanDrawsPerTurn, 3);
  assert.equal(DOMINO_ONE_VS_ONE_RULES.turnDurationMs, 25_000);
});

test("production 1v1 draw guards and lifecycle parity", () => {
  const eligible = { boardStarted: true, roundFinished: false, matchFinished: false,
    handHasPlayableTile: false, boneyardHasPlayableTile: true, boneyardCount: 1 };
  assert.equal(shouldOfferDraw(eligible), true);
  assert.equal(shouldOfferDraw({ ...eligible, handHasPlayableTile: true }), false);
  assert.equal(shouldOfferDraw({ ...eligible, boneyardHasPlayableTile: false }), false);
  assert.equal(deriveDominoOneVsOneLifecycle({ roundWinnerPlayerId: "u1" }), "round_result");
  assert.equal(deriveDominoOneVsOneLifecycle({ winningTeamId: "teamA" }), "finished");
});
