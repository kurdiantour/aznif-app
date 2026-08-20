import assert from "node:assert/strict";
import test from "node:test";

import {
  canDrawOneVsOne,
  resolveOneVsOneDrawProgress,
} from "../engine/domino-one-vs-one-engine.ts";

const eligible = {
  boardStarted: true,
  roundFinished: false,
  matchFinished: false,
  handHasPlayableTile: false,
  boneyardCount: 4,
  currentTurnDrawCount: 0,
};

test("draw eligibility preserves the production three-draw limit", () => {
  assert.equal(canDrawOneVsOne(eligible), true);
  assert.equal(canDrawOneVsOne({ ...eligible, currentTurnDrawCount: 2 }), true);
  assert.equal(canDrawOneVsOne({ ...eligible, currentTurnDrawCount: 3 }), false);
  assert.equal(canDrawOneVsOne({ ...eligible, handHasPlayableTile: true }), false);
  assert.equal(canDrawOneVsOne({ ...eligible, boneyardCount: 0 }), false);
});

test("a playable drawn tile keeps the turn and closes draw phase", () => {
  assert.deepEqual(resolveOneVsOneDrawProgress({
    nextTurnDrawCount: 1,
    hasPlayableTileAfterDraw: true,
    remainingBoneyardCount: 3,
  }), {
    shouldAutoPass: false,
    stillNeedsDraw: false,
    storedTurnDrawCount: 1,
  });
});

test("third unsuccessful draw auto-passes and resets draw count", () => {
  assert.deepEqual(resolveOneVsOneDrawProgress({
    nextTurnDrawCount: 3,
    hasPlayableTileAfterDraw: false,
    remainingBoneyardCount: 2,
  }), {
    shouldAutoPass: true,
    stillNeedsDraw: false,
    storedTurnDrawCount: 0,
  });
});

test("an unsuccessful draw continues only while the boneyard remains", () => {
  assert.equal(resolveOneVsOneDrawProgress({
    nextTurnDrawCount: 1,
    hasPlayableTileAfterDraw: false,
    remainingBoneyardCount: 2,
  }).stillNeedsDraw, true);
  assert.equal(resolveOneVsOneDrawProgress({
    nextTurnDrawCount: 1,
    hasPlayableTileAfterDraw: false,
    remainingBoneyardCount: 0,
  }).shouldAutoPass, true);
});
