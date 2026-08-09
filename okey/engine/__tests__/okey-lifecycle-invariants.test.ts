import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialOkeyGame,
  drawTile,
  getNextRoundDealerIndex,
  getRoundResultScoreDetails,
} from "../okey-engine.ts";
import { prepareTimeoutTurn, resolveTimeoutTurn } from "../okey-timeout.ts";
import type { OkeyGameState, OkeyTile } from "../../types/okey.ts";

let sequence = 0;
function tile(value: number, options: Partial<OkeyTile> = {}): OkeyTile {
  sequence += 1;
  return { id: `test-${value}-${sequence}`, color: "red", value, copy: 1, ...options };
}
function physicalTiles(state: OkeyGameState) {
  return [
    ...state.players.flatMap((player) => player.hand),
    ...state.deck,
    ...state.discardPile,
    state.indicatorTile,
  ];
}
function assertPhysicalInventory(state: OkeyGameState) {
  const tiles = physicalTiles(state);
  assert.equal(tiles.length, 106);
  assert.equal(new Set(tiles.map((entry) => entry.id)).size, 106);
}

test("initial deals preserve all 106 unique physical tiles for every dealer seat", () => {
  for (let dealer = 0; dealer < 4; dealer += 1) {
    for (let sample = 0; sample < 25; sample += 1) {
      const state = createInitialOkeyGame(dealer);
      assertPhysicalInventory(state);
      assert.equal(state.players[dealer].hand.length, 15);
      assert.equal(state.currentPlayerIndex, dealer);
    }
  }
});

test("tile inventory remains exact through repeated timeout turns", () => {
  let state = createInitialOkeyGame(0);
  for (let turn = 0; turn < 40 && state.phase === "playing"; turn += 1) {
    state = resolveTimeoutTurn(state, state.currentPlayerIndex);
    assertPhysicalInventory(state);
  }

});

test("draw pile rebuild preserves the top discard and increments reshuffle count", () => {
  const state = createInitialOkeyGame(0);
  const poolA = tile(3);
  const poolB = tile(4);
  const top = tile(5);
  const prepared: OkeyGameState = {
    ...state,
    deck: [],
    discardPile: [poolA, poolB, top],
    discardOwners: [null, null, null],
    reshuffleCount: 0,
    hasDrawnThisTurn: false,
  };
  const result = drawTile(prepared, "deck");
  assert.equal(result.reshuffleCount, 1);
  assert.deepEqual(result.discardPile.map((entry) => entry.id), [top.id]);
  assert.equal(result.players[0].hand.length, prepared.players[0].hand.length + 1);
  assert.equal(result.deck.length, 1);
});

test("fourth draw-pile cycle and an empty rebuild pool finish without a winner", () => {
  const state = createInitialOkeyGame(0);
  const top = tile(7);
  for (const prepared of [
    { ...state, deck: [], discardPile: [tile(6), top], discardOwners: [null, null], reshuffleCount: 3, hasDrawnThisTurn: false },
    { ...state, deck: [], discardPile: [top], discardOwners: [null], reshuffleCount: 0, hasDrawnThisTurn: false },
  ] satisfies OkeyGameState[]) {
    const result = drawTile(prepared, "deck");
    assert.equal(result.phase, "finished");
    assert.equal(result.endReason, "tile-cycle-limit");
    assert.equal(result.winnerId, null);
  }
});

test("timeout before draw discards exactly the drawn deck tile", () => {
  const state = createInitialOkeyGame(1);
  const playerIndex = state.currentPlayerIndex;
  const preparedState = { ...state, hasDrawnThisTurn: false };
  const expectedTileId = preparedState.deck[0].id;
  const beforeHandIds = preparedState.players[playerIndex].hand.map((entry) => entry.id).sort();
  const prepared = prepareTimeoutTurn(preparedState, playerIndex);
  assert.equal(prepared.drawnTileId, expectedTileId);
  const result = resolveTimeoutTurn(preparedState, playerIndex);
  assert.equal(result.discardPile.at(-1)?.id, expectedTileId);
  assert.deepEqual(result.players[playerIndex].hand.map((entry) => entry.id).sort(), beforeHandIds);
});

test("timeout after draw, wrong turn, and finished phase are deterministic", () => {
  const state = createInitialOkeyGame(0);
  const expectedDiscard = state.players[0].hand.at(-1)?.id;
  const resolved = resolveTimeoutTurn(state, 0);
  assert.equal(resolved.discardPile.at(-1)?.id, expectedDiscard);
  assert.notEqual(resolved.currentPlayerIndex, 0);
  assert.equal(resolveTimeoutTurn(state, 2), state);
  const finished = { ...state, phase: "finished" as const };
  assert.equal(resolveTimeoutTurn(finished, 0), finished);
});

test("basic and Konkan scoring cover opened, unopened, natural, and stolen joker penalties", () => {
  const state = createInitialOkeyGame(0);
  const winner = state.players[1];
  const penaltyHand = [
    tile(13, { color: state.okeyTile.color, value: state.okeyTile.value, jokerOrigin: "natural" }),
    tile(13, { color: state.okeyTile.color, value: state.okeyTile.value, jokerOrigin: "stolen" }),
    tile(5),
  ];
  const finished = (konkan: boolean): OkeyGameState => ({
    ...state,
    phase: "finished",
    endReason: "win",
    winnerId: winner.id,
    players: state.players.map((player, index) => index === 0
      ? { ...player, opened: true, hand: penaltyHand }
      : index === 1
        ? { ...player, opened: false, konkan, hand: [] }
        : index === 2
          ? { ...player, opened: false, hand: [tile(9)] }
          : { ...player, opened: true, hand: [] }),
  });
  const basic = getRoundResultScoreDetails(finished(false));
  assert.equal(basic.details.find((detail) => detail.playerId === state.players[0].id)?.points, 32);
  assert.equal(basic.details.find((detail) => detail.playerId === state.players[2].id)?.points, 100);
  assert.equal(basic.scores.teamA, 132);
  const konkan = getRoundResultScoreDetails(finished(true));
  assert.equal(konkan.details.find((detail) => detail.playerId === state.players[0].id)?.points, 132);
  assert.equal(konkan.details.find((detail) => detail.playerId === state.players[2].id)?.points, 200);
  assert.equal(konkan.scores.teamA, 332);
  assert.equal(konkan.scores.teamB, 0);
});

test("next-round dealer is the previous round winner", () => {
  const state = createInitialOkeyGame(0);
  for (let winnerIndex = 0; winnerIndex < state.players.length; winnerIndex += 1) {
    assert.equal(getNextRoundDealerIndex({ ...state, winnerId: state.players[winnerIndex].id }), winnerIndex);
  }
});

test("serialized mid-timeout state restores without losing or duplicating tiles", () => {
  const state = createInitialOkeyGame(3);
  const midTimeout = prepareTimeoutTurn({ ...state, hasDrawnThisTurn: false }, 3).state;
  const restored = JSON.parse(JSON.stringify(midTimeout)) as OkeyGameState;
  assertPhysicalInventory(restored);
  assert.equal(restored.currentPlayerIndex, midTimeout.currentPlayerIndex);
  assert.equal(restored.hasDrawnThisTurn, true);
  assert.deepEqual(
    physicalTiles(restored).map((entry) => entry.id).sort(),
    physicalTiles(midTimeout).map((entry) => entry.id).sort(),
  );
});
