import assert from "node:assert/strict";
import test from "node:test";
import { canSpendTileOnMeld, createInitialOkeyGame, spendTileOnMeld } from "../okey-engine.ts";
import { getMeldScore } from "../okey-melds.ts";
import type { OkeyGameState, OkeyMeld, OkeyTile } from "../../types/okey.ts";

const okeyTile: OkeyTile = { id: "okey-reference", color: "blue", value: 13, copy: 1 };
function tile(id: string, color: OkeyTile["color"], value: number): OkeyTile {
  return { id, color, value, copy: 1 };
}
function realJoker(id = "real-joker"): OkeyTile {
  return tile(id, okeyTile.color, okeyTile.value);
}
function meld(id: string, ownerId: string, kind: "run" | "set", tiles: OkeyTile[], locked = false): OkeyMeld {
  return { id, ownerId, kind, tiles, score: getMeldScore(tiles, okeyTile) ?? 0, locked };
}
function replacementState(targetIndex: number, targetMeld: OkeyMeld, replacement: OkeyTile, opened = false): OkeyGameState {
  const state = createInitialOkeyGame(0);
  return {
    ...state,
    currentPlayerIndex: 0,
    okeyTile,
    players: state.players.map((player, index) => {
      if (index === 0) return { ...player, hand: [replacement, tile("filler", "yellow", 1)], opened, scoreOpened: opened ? 42 : 0, konkan: false, konkanEntryReason: null };
      if (index === targetIndex) return { ...player, opened: true, melds: [{ ...targetMeld, ownerId: player.id }] };
      return player;
    }),
  };
}

for (const targetIndex of [1, 2, 3]) {
  test(`closed player can replace a real joker owned by player ${targetIndex}`, () => {
    const replacement = tile(`red-4-${targetIndex}`, "red", 4);
    const target = meld(`run-${targetIndex}`, "placeholder", "run", [tile(`red-3-${targetIndex}`, "red", 3), realJoker(`joker-${targetIndex}`), tile(`red-5-${targetIndex}`, "red", 5)]);
    const state = replacementState(targetIndex, target, replacement);
    const owner = state.players[targetIndex];
    assert.equal(canSpendTileOnMeld(state, 0, replacement.id, owner.id, target.id), true);
    const result = spendTileOnMeld(state, 0, replacement.id, owner.id, target.id);
    const actor = result.players[0];
    assert.equal(actor.opened, false);
    assert.equal(actor.scoreOpened, 0);
    assert.equal(actor.konkan, true);
    assert.equal(actor.konkanEntryReason, "joker-replacement");
    assert.ok(actor.hand.some((entry) => entry.id === `joker-${targetIndex}` && entry.jokerOrigin === "stolen"));
    assert.equal(result.players[targetIndex].melds[0].tiles[1].id, replacement.id);
  });
}

test("an already-opened player performs an ordinary replacement without entering KonKan", () => {
  const replacement = tile("red-4", "red", 4);
  const target = meld("opened-run", "placeholder", "run", [tile("red-3", "red", 3), realJoker(), tile("red-5", "red", 5)]);
  const state = replacementState(2, target, replacement, true);
  const result = spendTileOnMeld(state, 0, replacement.id, state.players[2].id, target.id);
  assert.equal(result.players[0].opened, true);
  assert.equal(result.players[0].scoreOpened, 42);
  assert.equal(result.players[0].konkan, false);
  assert.equal(result.players[0].konkanEntryReason, null);
});

test("replacement works for valid three- and four-tile sets", () => {
  for (const [id, tiles, replacement] of [
    ["set-3", [tile("r7a", "red", 7), tile("b7a", "blue", 7), realJoker("j3")], tile("k7a", "black", 7)],
    ["set-4", [tile("r7b", "red", 7), tile("b7b", "blue", 7), tile("y7b", "yellow", 7), realJoker("j4")], tile("k7b", "black", 7)],
  ] as const) {
    const target = meld(id, "placeholder", "set", [...tiles]);
    const state = replacementState(1, target, replacement);
    assert.equal(canSpendTileOnMeld(state, 0, replacement.id, state.players[1].id, target.id), true);
  }
});

test("a real joker can be replaced and stolen from a locked meld", () => {
  const replacement = tile("red-4-locked", "red", 4);
  const target = {
    ...meld("locked-run", "placeholder", "run", [tile("red-3-locked", "red", 3), realJoker("locked-joker"), tile("red-5-locked", "red", 5)]),
    locked: true,
    lockedTileId: "red-5-locked",
  };
  const state = replacementState(1, target, replacement);
  assert.equal(canSpendTileOnMeld(state, 0, replacement.id, state.players[1].id, target.id), true);
  const result = spendTileOnMeld(state, 0, replacement.id, state.players[1].id, target.id);
  assert.ok(result.players[0].hand.some((entry) => entry.id === "locked-joker" && entry.jokerOrigin === "stolen"));
  assert.equal(result.players[1].melds[0].locked, true);
  assert.equal(result.players[1].melds[0].lockedTileId, "red-5-locked");
});
test("an opened player can replace and steal a joker from their own meld", () => {
  const replacement = tile("red-4-own", "red", 4);
  const base = meld("own-run", "placeholder", "run", [tile("red-3-own", "red", 3), realJoker("own-joker"), tile("red-5-own", "red", 5)]);
  const ownState = replacementState(1, base, replacement, true);
  ownState.players[0] = { ...ownState.players[0], melds: [{ ...base, ownerId: ownState.players[0].id }] };

  assert.equal(canSpendTileOnMeld(ownState, 0, replacement.id, ownState.players[0].id, base.id), true);
  const result = spendTileOnMeld(ownState, 0, replacement.id, ownState.players[0].id, base.id);
  assert.equal(result.players[0].melds[0].tiles[1].id, replacement.id);
  assert.ok(result.players[0].hand.some((entry) => entry.id === "own-joker" && entry.jokerOrigin === "stolen"));
});

test("fake joker and incorrect replacement are rejected", () => {
  const replacement = tile("red-4-invalid", "red", 4);
  const base = meld("invalid-run", "placeholder", "run", [tile("red-3-invalid", "red", 3), realJoker("invalid-joker"), tile("red-5-invalid", "red", 5)]);
  const fakeMeld = meld("fake-run", "placeholder", "run", [tile("fake-3", "red", 3), { ...okeyTile, id: "fake", isFakeJoker: true }, tile("fake-5", "red", 5)]);
  const fakeState = replacementState(1, fakeMeld, replacement);
  assert.equal(canSpendTileOnMeld(fakeState, 0, replacement.id, fakeState.players[1].id, fakeMeld.id), false);

  const wrong = tile("wrong", "yellow", 9);
  const wrongState = replacementState(1, base, wrong);
  assert.equal(canSpendTileOnMeld(wrongState, 0, wrong.id, wrongState.players[1].id, base.id), false);
});