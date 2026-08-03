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