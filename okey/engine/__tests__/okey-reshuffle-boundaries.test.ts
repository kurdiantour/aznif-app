import assert from "node:assert/strict";
import test from "node:test";

import { createInitialOkeyGame, drawTile } from "../okey-engine.ts";
import type { OkeyGameState, OkeyTile } from "../../types/okey.ts";

let sequence = 0;
function tile(value: number): OkeyTile {
  sequence += 1;
  return { id: `pool-${value}-${sequence}`, color: "red", value, copy: 1 };
}

test("all three permitted draw-pile rebuilds increment exactly once", () => {
  const state = createInitialOkeyGame(0);
  for (const reshuffleCount of [0, 1, 2]) {
    const top = tile(5);
    const prepared: OkeyGameState = {
      ...state,
      deck: [],
      discardPile: [tile(3), tile(4), top],
      discardOwners: [null, null, null],
      reshuffleCount,
      hasDrawnThisTurn: false,
    };
    const result = drawTile(prepared, "deck");
    assert.equal(result.phase, "playing");
    assert.equal(result.reshuffleCount, reshuffleCount + 1);
    assert.deepEqual(result.discardPile.map((entry) => entry.id), [top.id]);
  }
});

test("a fourth rebuild attempt ends the round without drawing", () => {
  const state = createInitialOkeyGame(0);
  const handSize = state.players[0].hand.length;
  const result = drawTile({
    ...state,
    deck: [],
    discardPile: [tile(3), tile(4)],
    discardOwners: [null, null],
    reshuffleCount: 3,
    hasDrawnThisTurn: false,
  }, "deck");
  assert.equal(result.phase, "finished");
  assert.equal(result.endReason, "tile-cycle-limit");
  assert.equal(result.players[0].hand.length, handSize);
});
