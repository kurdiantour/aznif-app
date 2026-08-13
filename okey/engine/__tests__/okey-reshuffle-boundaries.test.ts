import assert from "node:assert/strict";
import test from "node:test";

import { createInitialOkeyGame, drawTile } from "../okey-engine.ts";
import type { OkeyColor, OkeyGameState, OkeyMeld, OkeyTile } from "../../types/okey.ts";

let sequence = 0;
function tile(value: number): OkeyTile {
  sequence += 1;
  return { id: `pool-${value}-${sequence}`, color: "red", value, copy: 1 };
}

function coloredTile(value: number, color: OkeyColor): OkeyTile {
  sequence += 1;
  return { id: `meld-${color}-${value}-${sequence}`, color, value, copy: 1 };
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

test("reshuffle collects only complete natural four-color sets from the table", () => {
  const state = createInitialOkeyGame(0);
  const completeSetTiles = (["red", "blue", "black", "yellow"] as const).map((color) => coloredTile(5, color));
  const incompleteSetTiles = (["red", "blue", "black"] as const).map((color) => coloredTile(9, color));
  const runTiles = [5, 6, 7].map((value) => coloredTile(value, "yellow"));
  const melds: OkeyMeld[] = [
    { id: "complete-set", ownerId: state.players[1].id, kind: "set", tiles: completeSetTiles, score: 20 },
    { id: "incomplete-set", ownerId: state.players[1].id, kind: "set", tiles: incompleteSetTiles, score: 27 },
    { id: "run", ownerId: state.players[1].id, kind: "run", tiles: runTiles, score: 18 },
  ];
  const oldDiscard = tile(3);
  const topDiscard = tile(4);
  const initialHandIds = new Set(state.players[0].hand.map((entry) => entry.id));

  const result = drawTile({
    ...state,
    players: state.players.map((player, index) => index === 1 ? { ...player, melds } : player),
    deck: [],
    discardPile: [oldDiscard, topDiscard],
    discardOwners: [null, null],
    hasDrawnThisTurn: false,
  }, "deck");

  assert.equal(result.phase, "playing");
  assert.deepEqual(result.discardPile.map((entry) => entry.id), [topDiscard.id]);
  assert.deepEqual(result.players[1].melds.map((meld) => meld.id), ["incomplete-set", "run"]);

  const recycledIds = new Set([
    ...result.deck.map((entry) => entry.id),
    ...result.players[0].hand.filter((entry) => !initialHandIds.has(entry.id)).map((entry) => entry.id),
  ]);
  assert.deepEqual(recycledIds, new Set([oldDiscard.id, ...completeSetTiles.map((entry) => entry.id)]));
});