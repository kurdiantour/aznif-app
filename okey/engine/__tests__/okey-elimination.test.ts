import assert from "node:assert/strict";
import test from "node:test";
import {
  canDeclareKonkanOpen,
  createInitialOkeyGame,
  drawTile,
  movePlayerHandTile,
  openPlayerMelds,
  playEliminatedTurn,
} from "../okey-engine.ts";
import type { OkeyGameState, OkeyMeld, OkeyTile } from "../../types/okey.ts";

function tile(value: number, id = `tile-${value}`): OkeyTile {
  return { id, color: "red", value, copy: 1 };
}
function eliminatedState(): OkeyGameState {
  const state = createInitialOkeyGame(0);
  return {
    ...state,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: false,
    deck: [tile(13, "forced-draw"), tile(12, "next-deck")],
    discardPile: [],
    discardOwners: [],
    players: state.players.map((player, index) => index === 0
      ? { ...player, eliminated: true, hand: [tile(3), tile(4), tile(5)], konkan: true }
      : player),
  };
}

test("an eliminated turn draws and immediately discards exactly the deck tile", () => {
  const state = eliminatedState();
  const originalHandIds = state.players[0].hand.map((entry) => entry.id);
  const result = playEliminatedTurn(state);
  assert.deepEqual(result.players[0].hand.map((entry) => entry.id), originalHandIds);
  assert.equal(result.deck[0].id, "next-deck");
  assert.equal(result.discardPile.at(-1)?.id, "forced-draw");
  assert.equal(result.discardOwners.at(-1)?.playerId, state.players[0].id);
  assert.notEqual(result.currentPlayerIndex, 0);
  assert.equal(result.hasDrawnThisTurn, false);
});

test("nobody can pick a discard owned by an eliminated player", () => {
  const afterBurnedTurn = playEliminatedTurn(eliminatedState());
  assert.equal(drawTile(afterBurnedTurn, "discard"), afterBurnedTurn);
});

test("manual draw, rack movement, opening, and KonKan declaration stay locked", () => {
  const state = eliminatedState();
  const submitted: OkeyMeld = {
    id: "submitted",
    ownerId: state.players[0].id,
    kind: "run",
    tiles: state.players[0].hand,
    score: 12,
  };
  assert.equal(drawTile(state, "deck"), state);
  assert.equal(movePlayerHandTile(state, 0, state.players[0].hand[0].id, 2), state);
  assert.equal(openPlayerMelds(state, 0, [submitted], 12), state);
  assert.equal(canDeclareKonkanOpen(state, 0), false);
});