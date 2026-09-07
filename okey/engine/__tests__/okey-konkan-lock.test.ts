import assert from "node:assert/strict";
import test from "node:test";
import { canLockKonkanSet, canSpendTileOnMeld, createInitialOkeyGame, lockKonkanSet, spendTileOnMeld } from "../okey-engine.ts";
import { getMeldScore } from "../okeyengine-melds.ts";
import type { OkeyGameState, OkeyMeld, OkeyTile } from "../../types/okey.ts";

const okeyTile: OkeyTile = { id: "okey", color: "blue", value: 13, copy: 1 };
function tile(id: string, color: OkeyTile["color"], value: number): OkeyTile {
  return { id, color, value, copy: 1 };
}
function lockState(options: { actorKonkan?: boolean; actorOpened?: boolean; targetOpened?: boolean; kind?: "set" | "run" } = {}): OkeyGameState {
  const state = createInitialOkeyGame(0);
  const kind = options.kind ?? "set";
  const lockTile = kind === "set" ? tile("lock-tile", "black", 7) : tile("lock-tile", "red", 6);
  const targetTiles = kind === "set"
    ? [tile("set-red-7", "red", 7), tile("set-blue-7", "blue", 7), tile("set-yellow-7", "yellow", 7)]
    : [tile("run-red-3", "red", 3), tile("run-red-4", "red", 4), tile("run-red-5", "red", 5)];
  const targetMeld: OkeyMeld = {
    id: "target-meld",
    ownerId: state.players[1].id,
    kind,
    tiles: targetTiles,
    score: getMeldScore(targetTiles, okeyTile) ?? 0,
  };
  return {
    ...state,
    currentPlayerIndex: 0,
    okeyTile,
    players: state.players.map((player, index) => {
      if (index === 0) return {
        ...player,
        hand: [lockTile, tile("unrelated", "yellow", 12)],
        opened: options.actorOpened ?? false,
        scoreOpened: options.actorOpened ? 40 : 0,
        konkan: options.actorKonkan ?? true,
        konkanEntryReason: "discard-pick",
      };
      if (index === 1) return {
        ...player,
        opened: options.targetOpened ?? true,
        melds: [targetMeld],
      };
      return player;
    }),
  };
}

test("KonKan player can Spend/Lock without a ten-tile run, set, or fourteenth tile", () => {
  const state = lockState();
  assert.equal(canLockKonkanSet(state, 0, "lock-tile", state.players[1].id, "target-meld"), true);
  const result = lockKonkanSet(state, 0, "lock-tile", state.players[1].id, "target-meld");
  const actor = result.players[0];
  const locked = result.players[1].melds[0];
  assert.deepEqual(actor.hand.map((entry) => entry.id), ["unrelated"]);
  assert.equal(actor.opened, false);
  assert.equal(actor.scoreOpened, 0);
  assert.equal(actor.konkan, true);
  assert.equal(locked.tiles.at(-1)?.id, "lock-tile");
  assert.equal(locked.locked, true);
  assert.equal(locked.lockedByPlayerId, actor.id);
  assert.equal(locked.lockedTileId, "lock-tile");
});

test("Spend/Lock supports a compatible open run", () => {
  const state = lockState({ kind: "run" });
  const result = lockKonkanSet(state, 0, "lock-tile", state.players[1].id, "target-meld");
  assert.equal(result.players[1].melds[0].tiles.at(-1)?.value, 6);
  assert.equal(result.players[1].melds[0].locked, true);
});

test("the movement preserves opened and scoreOpened exactly", () => {
  const state = lockState({ actorOpened: true });
  const result = lockKonkanSet(state, 0, "lock-tile", state.players[1].id, "target-meld");
  assert.equal(result.players[0].opened, true);
  assert.equal(result.players[0].scoreOpened, 40);
  assert.equal(result.players[0].konkan, true);
});

test("Spend/Lock is limited to once per KonKan player", () => {
  const state = lockState();
  const first = lockKonkanSet(state, 0, "lock-tile", state.players[1].id, "target-meld");
  const secondTile = tile("second-lock", "red", 2);
  const secondTarget: OkeyMeld = {
    id: "second-target",
    ownerId: first.players[2].id,
    kind: "run",
    tiles: [tile("second-3", "red", 3), tile("second-4", "red", 4), tile("second-5", "red", 5)],
    score: 12,
  };
  const next = {
    ...first,
    players: first.players.map((player, index) => index === 0
      ? { ...player, hand: [...player.hand, secondTile] }
      : index === 2
        ? { ...player, opened: true as const, melds: [secondTarget] }
        : player),
  };
  assert.equal(canLockKonkanSet(next, 0, secondTile.id, next.players[2].id, secondTarget.id), true);
  const burned = lockKonkanSet(next, 0, secondTile.id, next.players[2].id, secondTarget.id);
  assert.equal(burned.players[0].eliminated, true);
  assert.notEqual(burned.currentPlayerIndex, 0);
  assert.equal(burned.hasDrawnThisTurn, false);
});

test("an ordinary KonKan Spend consumes the Lock", () => {
  const state = lockState();
  const first = spendTileOnMeld(state, 0, "lock-tile", state.players[1].id, "target-meld");
  const locked = first.players[1].melds[0];
  assert.equal(locked.locked, true);
  assert.equal(locked.lockedByPlayerId, first.players[0].id);
  assert.equal(locked.lockedTileId, "lock-tile");

  const secondTile = tile("second-lock", "black", 7);
  const next = { ...first, players: first.players.map((player, index) => index === 0 ? { ...player, hand: [...player.hand, secondTile] } : player) };
  assert.equal(canSpendTileOnMeld(next, 0, secondTile.id, next.players[1].id, "target-meld"), false);
  assert.equal(canLockKonkanSet(next, 0, secondTile.id, next.players[1].id, "target-meld"), false);
});
test("non-KonKan, wrong turn, unopened target, and incompatible tile are rejected", () => {
  const notKonkan = lockState({ actorKonkan: false });
  assert.equal(canLockKonkanSet(notKonkan, 0, "lock-tile", notKonkan.players[1].id, "target-meld"), false);

  const wrongTurn = { ...lockState(), currentPlayerIndex: 2 };
  assert.equal(canLockKonkanSet(wrongTurn, 0, "lock-tile", wrongTurn.players[1].id, "target-meld"), false);

  const unopened = lockState({ targetOpened: false });
  assert.equal(canLockKonkanSet(unopened, 0, "lock-tile", unopened.players[1].id, "target-meld"), false);

  const incompatible = lockState();
  incompatible.players[0] = { ...incompatible.players[0], hand: [tile("wrong", "red", 12)] };
  assert.equal(canLockKonkanSet(incompatible, 0, "wrong", incompatible.players[1].id, "target-meld"), false);
});
test("blue 10 can lock onto the descending 1-13-12-11 blue run", () => {
  const state = lockState({ kind: "run" });
  const blueTen = tile("blue-10", "blue", 10);
  const wrapRun = [tile("blue-1", "blue", 1), tile("blue-13", "blue", 13), tile("blue-12", "blue", 12), tile("blue-11", "blue", 11)];
  state.players[0] = { ...state.players[0], hand: [blueTen] };
  state.players[1] = {
    ...state.players[1],
    melds: [{ id: "wrap-run", ownerId: state.players[1].id, kind: "run", tiles: wrapRun, score: getMeldScore(wrapRun, okeyTile) ?? 0 }],
  };
  assert.equal(canLockKonkanSet(state, 0, blueTen.id, state.players[1].id, "wrap-run"), true);
  const result = lockKonkanSet(state, 0, blueTen.id, state.players[1].id, "wrap-run");
  assert.deepEqual(result.players[1].melds[0].tiles.map((entry) => entry.value), [1, 13, 12, 11, 10]);
});
test("a locked run blocks only the locked endpoint", () => {
  const state = lockState({ kind: "run" });
  const descendingRun = [tile("red-10", "red", 10), tile("red-9", "red", 9), tile("red-8", "red", 8), tile("red-7", "red", 7)];
  const lockTile = tile("lock-11", "red", 11);
  state.players[0] = { ...state.players[0], hand: [lockTile] };
  state.players[1] = { ...state.players[1], melds: [{ id: "descending-run", ownerId: state.players[1].id, kind: "run", tiles: descendingRun, score: getMeldScore(descendingRun, okeyTile) ?? 0 }] };

  const locked = lockKonkanSet(state, 0, lockTile.id, state.players[1].id, "descending-run");
  assert.deepEqual(locked.players[1].melds[0].tiles.map((entry) => entry.value), [11, 10, 9, 8, 7]);

  const twelve = tile("red-12", "red", 12);
  const six = tile("red-6", "red", 6);
  const spendState = { ...locked, currentPlayerIndex: 2, players: locked.players.map((player, index) => index === 2 ? { ...player, opened: true, hand: [twelve, six] } : player) };

  assert.equal(canSpendTileOnMeld(spendState, 2, twelve.id, spendState.players[1].id, "descending-run"), false);
  assert.equal(canSpendTileOnMeld(spendState, 2, six.id, spendState.players[1].id, "descending-run"), true);
  const spent = spendTileOnMeld(spendState, 2, six.id, spendState.players[1].id, "descending-run");
  assert.deepEqual(spent.players[1].melds[0].tiles.map((entry) => entry.value), [11, 10, 9, 8, 7, 6]);
  assert.equal(spent.players[1].melds[0].lockedTileId, lockTile.id);
});

test("ambiguous Joker Lock requires and honors an explicit endpoint", () => {
  const state = lockState({ kind: "run" });
  const joker = { ...okeyTile, id: "ambiguous-lock-joker" };
  const run = [tile("red-9", "red", 9), tile("red-10", "red", 10), tile("red-11", "red", 11)];
  state.players[0] = { ...state.players[0], hand: [joker] };
  state.players[1] = {
    ...state.players[1],
    melds: [{ id: "ambiguous-lock-run", ownerId: state.players[1].id, kind: "run", tiles: run, score: getMeldScore(run, okeyTile) ?? 0 }],
  };

  assert.equal(lockKonkanSet(state, 0, joker.id, state.players[1].id, "ambiguous-lock-run"), state);
  const start = lockKonkanSet(state, 0, joker.id, state.players[1].id, "ambiguous-lock-run", "start");
  const end = lockKonkanSet(state, 0, joker.id, state.players[1].id, "ambiguous-lock-run", "end");
  assert.equal(start.players[1].melds[0].tiles[0].id, joker.id);
  assert.equal(end.players[1].melds[0].tiles.at(-1)?.id, joker.id);
});
