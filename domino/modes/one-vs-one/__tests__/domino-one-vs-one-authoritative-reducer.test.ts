import assert from "node:assert/strict";
import test from "node:test";

import { reduceOneVsOneDraw } from "../authoritative/domino-one-vs-one-command-reducer.ts";

const tile = (id: string) => ({ id, left: 1, right: 2 });

test("draw reducer keeps the current turn when the drawn tile is playable", () => {
  const result = reduceOneVsOneDraw({
    state: { currentTurnDrawCount: 0, turnStartedAt: "old" },
    hands: [[tile("hand")], [tile("opponent")]],
    boneyard: [tile("drawn"), tile("remaining")],
    activePlayerIndex: 0,
    currentTurnPlayerId: "player-a",
    opponentPlayerId: "player-b",
    hasPlayableTileAfterDraw: (hand) => hand.some((entry) => entry.id === "drawn"),
    phaseStartedAt: "now",
  });

  assert.equal(result.finalTurnPlayerId, "player-a");
  assert.equal(result.nextState.turnStartedAt, "now");
  assert.equal(result.nextState.drawStartedAt, null);
  assert.equal(result.nextState.currentTurnDrawCount, 1);
  assert.deepEqual(result.nextState.handCounts, [2, 1]);
});

test("draw reducer continues draw phase without resetting original turn time", () => {
  const result = reduceOneVsOneDraw({
    state: { currentTurnDrawCount: 0, turnStartedAt: "old" },
    hands: [[], []],
    boneyard: [tile("drawn"), tile("remaining")],
    activePlayerIndex: 0,
    currentTurnPlayerId: "player-a",
    opponentPlayerId: "player-b",
    hasPlayableTileAfterDraw: () => false,
    phaseStartedAt: "now",
  });

  assert.equal(result.stillNeedsDraw, true);
  assert.equal(result.nextState.turnStartedAt, "old");
  assert.equal(result.nextState.drawStartedAt, "now");
  assert.equal(result.nextState.canDrawTile, true);
});

test("third unsuccessful draw auto-passes and resets count", () => {
  const result = reduceOneVsOneDraw({
    state: { currentTurnDrawCount: 2, turnStartedAt: "old" },
    hands: [[], []],
    boneyard: [tile("drawn"), tile("remaining")],
    activePlayerIndex: 0,
    currentTurnPlayerId: "player-a",
    opponentPlayerId: "player-b",
    hasPlayableTileAfterDraw: () => false,
    phaseStartedAt: "now",
  });

  assert.equal(result.shouldAutoPass, true);
  assert.equal(result.finalTurnPlayerId, "player-b");
  assert.equal(result.nextState.currentTurnDrawCount, 0);
  assert.equal(result.nextState.lastPassedPlayerId, "player-a");
  assert.deepEqual(result.nextState.blockedPasses, ["player-a"]);
});

test("draw reducer rejects malformed authoritative input", () => {
  assert.throws(() => reduceOneVsOneDraw({
    state: {},
    hands: [[]],
    boneyard: [tile("drawn")],
    activePlayerIndex: 0,
    currentTurnPlayerId: "player-a",
    opponentPlayerId: "player-b",
    hasPlayableTileAfterDraw: () => false,
    phaseStartedAt: "now",
  }), /exactly_two_hands/);
});
