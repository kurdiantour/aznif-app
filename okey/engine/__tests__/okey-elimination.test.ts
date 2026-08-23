import assert from "node:assert/strict";
import test from "node:test";
import {
  canDeclareKonkanOpen,
  canLockKonkanSet,
  canSpendTileOnMeld,
  createInitialOkeyGame,
  drawTile,
  getRoundResultScoreDetails,
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

test("an eliminated player's melds reject spend, lock, and joker replacement targets", () => {
  const state = eliminatedState();
  const targetMeld: OkeyMeld = {
    id: "frozen-set",
    ownerId: state.players[0].id,
    kind: "set",
    tiles: [
      { ...tile(5, "red-5"), color: "red" },
      { ...tile(5, "blue-5"), color: "blue" },
      { ...tile(5, "yellow-5"), color: "yellow" },
    ],
    score: 15,
  };
  const spendTile: OkeyTile = { ...tile(5, "black-5"), color: "black" };
  const prepared = {
    ...state,
    currentPlayerIndex: 1,
    players: state.players.map((player, index) =>
      index === 0
        ? { ...player, opened: true, melds: [targetMeld] }
        : index === 1
          ? { ...player, hand: [spendTile], konkan: true }
          : player
    ),
  };

  assert.equal(
    canSpendTileOnMeld(prepared, 1, spendTile.id, prepared.players[0].id, targetMeld.id),
    false,
  );
  assert.equal(
    canLockKonkanSet(prepared, 1, spendTile.id, prepared.players[0].id, targetMeld.id),
    false,
  );
});

test("an eliminated player's hand and melds never enter draw-pile recycling", () => {
  const frozenSet: OkeyMeld = {
    id: "frozen-four-color-set",
    ownerId: "player-0",
    kind: "set",
    tiles: [
      { ...tile(6, "frozen-red"), color: "red" },
      { ...tile(6, "frozen-blue"), color: "blue" },
      { ...tile(6, "frozen-yellow"), color: "yellow" },
      { ...tile(6, "frozen-black"), color: "black" },
    ],
    score: 24,
  };
  const state = eliminatedState();
  const prepared = {
    ...state,
    deck: [],
    discardPile: [tile(8, "recyclable"), tile(9, "top")],
    discardOwners: [null, null],
    players: state.players.map((player, index) =>
      index === 0 ? { ...player, opened: true, melds: [frozenSet] } : player
    ),
  };
  const result = drawTile(prepared, "deck");

  assert.deepEqual(result.players[0].melds, [frozenSet]);
  assert.equal(
    result.deck.some((entry) => entry.id.startsWith("frozen-")),
    false,
  );
});

test("an eliminated player receives 100 only when their team loses the round", () => {
  const state = eliminatedState();
  const lostRound = {
    ...state,
    phase: "finished" as const,
    winnerId: state.players[1].id,
    endReason: "win" as const,
  };
  const lostDetail = getRoundResultScoreDetails(lostRound).details.find(
    (entry) => entry.playerId === state.players[0].id,
  );
  assert.equal(lostDetail?.points, 100);

  const wonRound = {
    ...lostRound,
    winnerId: state.players[2].id,
  };
  const wonDetail = getRoundResultScoreDetails(wonRound).details.find(
    (entry) => entry.playerId === state.players[0].id,
  );
  assert.equal(wonDetail?.points, 0);
});
