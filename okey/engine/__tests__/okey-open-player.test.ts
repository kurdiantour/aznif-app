import assert from "node:assert/strict";
import test from "node:test";
import { createInitialOkeyGame, openPlayerMelds } from "../okey-engine.ts";
import type { OkeyGameState, OkeyMeld, OkeyTile } from "../../types/okey.ts";

function tile(value: number, id = `red-${value}`): OkeyTile {
  return { id, color: "red", value, copy: 1 };
}
function openState(hand: OkeyTile[]): OkeyGameState {
  const state = createInitialOkeyGame(0);
  return {
    ...state,
    okeyTile: { id: "okey", color: "blue", value: 13, copy: 1 },
    players: state.players.map((player, index) => index === 0
      ? { ...player, hand, opened: true, melds: [], scoreOpened: 0, konkan: false }
      : player),
  };
}
function run(tiles: OkeyTile[], score = 999): OkeyMeld {
  return { id: "submitted", ownerId: "human", kind: "run", tiles, score };
}

test("openPlayerMelds splits a seven-tile preview at the engine boundary", () => {
  const runTiles = Array.from({ length: 7 }, (_, index) => tile(index + 3));
  const remainder = tile(12, "remainder");
  const result = openPlayerMelds(openState([...runTiles, remainder]), 0, [run(runTiles)], 9999);
  assert.deepEqual(result.players[0].melds.map((meld) => meld.tiles.length), [3, 4]);
  assert.deepEqual(result.players[0].hand.map((entry) => entry.id), [remainder.id]);
  assert.equal(result.players[0].scoreOpened, runTiles.reduce((sum, entry) => sum + entry.value, 0));
});

test("openPlayerMelds ignores caller scores and recomputes every meld", () => {
  const tiles = [tile(3), tile(4), tile(5), tile(10, "remainder")];
  const result = openPlayerMelds(openState(tiles), 0, [run(tiles.slice(0, 3), 10000)], 10000);
  assert.equal(result.players[0].scoreOpened, 12);
  assert.equal(result.players[0].melds[0].score, 12);
});

test("openPlayerMelds rejects duplicate, foreign, and un-splittable inputs", () => {
  const tiles = [tile(3), tile(4), tile(5), tile(10, "remainder")];
  const state = openState(tiles);
  const duplicate = run([tiles[0], tiles[1], tiles[2], tiles[0]]);
  const foreign = run([tiles[0], tiles[1], tile(5, "foreign")]);
  const tooShort = run([tiles[0], tiles[1]]);
  for (const submitted of [duplicate, foreign, tooShort]) {
    assert.equal(openPlayerMelds(state, 0, [submitted], submitted.score), state);
  }
});

test("normal open remains disabled for KonKan players", () => {
  const tiles = [tile(3), tile(4), tile(5), tile(10, "remainder")];
  const state = openState(tiles);
  state.players[0] = { ...state.players[0], konkan: true };
  assert.equal(openPlayerMelds(state, 0, [run(tiles.slice(0, 3))], 12), state);
});
test("opening is rejected outside the player's turn", () => {
  const tiles = [tile(3), tile(4), tile(5), tile(10, "remainder")];
  const state = { ...openState(tiles), currentPlayerIndex: 1 };
  assert.equal(openPlayerMelds(state, 0, [run(tiles.slice(0, 3))], 12), state);
});

// --- Regression: normalizeOpenMelds run ordering contract ---
// Short runs (≤5 tiles) must be submitted in correct order by the player.
// Long runs (>5 tiles) are auto-sorted then split into legal sub-melds.

test("short run submitted out of order (5-3-4) is rejected", () => {
  const outOfOrder = [tile(5, "r5"), tile(3, "r3"), tile(4, "r4")];
  const remainder = tile(10, "remainder");
  const state = openState([...outOfOrder, remainder]);
  // The mis-ordered run should be rejected — state unchanged.
  assert.equal(openPlayerMelds(state, 0, [run(outOfOrder)], 12), state);
});

test("short run submitted in correct order (3-4-5) is accepted", () => {
  const inOrder = [tile(3, "r3"), tile(4, "r4"), tile(5, "r5")];
  const remainder = tile(10, "remainder");
  const state = openState([...inOrder, remainder]);
  const result = openPlayerMelds(state, 0, [run(inOrder)], 12);
  assert.notEqual(result, state, "correctly ordered short run should be accepted");
  assert.equal(result.players[0].melds.length, 1);
  assert.equal(result.players[0].scoreOpened, 12);
});

test("long run (>5 tiles) submitted out of order is auto-sorted, split, and accepted", () => {
  // 7-tile run with values 3-9 submitted in scrambled order
  const scrambled = [tile(5, "r5"), tile(3, "r3"), tile(7, "r7"), tile(4, "r4"), tile(9, "r9"), tile(6, "r6"), tile(8, "r8")];
  const remainder = tile(12, "remainder");
  const state = openState([...scrambled, remainder]);
  const result = openPlayerMelds(state, 0, [run(scrambled)], 9999);
  assert.notEqual(result, state, "long run should be auto-sorted and accepted");
  // Should be split into sub-melds covering all 7 tiles (e.g. [3,4,5] + [6,7,8,9] or [3,4,5,6] + [7,8,9])
  const totalMeldTiles = result.players[0].melds.reduce((sum, m) => sum + m.tiles.length, 0);
  assert.equal(totalMeldTiles, 7, "all 7 tiles must be covered by sub-melds");
  assert.equal(result.players[0].scoreOpened, 3 + 4 + 5 + 6 + 7 + 8 + 9);
});