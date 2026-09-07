import assert from "node:assert/strict";
import test from "node:test";
import {
  canDeclareKonkanOpen,
  canLockKonkanSet,
  canSpendTileOnMeld,
  createInitialOkeyGame,
  drawTile,
  getOkeyOpenAction,
  getRoundResultScoreDetails,
  hasPlayerExecutedKonkanSpend,
  lockKonkanSet,
  movePlayerHandTile,
  openPlayerMelds,
  playEliminatedTurn,
  spendTileOnMeld,
} from "../okey-engine.ts";
import { applyAuthoritativeOkeyCommand } from "../../server/okey-authoritative.ts";
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

test("KonKan player: 1st spend is allowed and tracks spend count", () => {
  const okeyTile: OkeyTile = { id: "okey", color: "blue", value: 13, copy: 1 };
  const base = createInitialOkeyGame(0);
  const spendTile: OkeyTile = { id: "spend-1", color: "red", value: 6, copy: 1 };
  const targetTiles: OkeyTile[] = [
    { id: "target-1", color: "red", value: 3, copy: 1 },
    { id: "target-2", color: "red", value: 4, copy: 1 },
    { id: "target-3", color: "red", value: 5, copy: 1 },
  ];
  const targetMeld: OkeyMeld = {
    id: "target-run",
    ownerId: base.players[1].id,
    kind: "run",
    tiles: targetTiles,
    score: 12,
  };

  const state: OkeyGameState = {
    ...base,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    okeyTile,
    players: base.players.map((p, i) => {
      if (i === 0) return { ...p, hand: [spendTile, { id: "other", color: "black", value: 1, copy: 1 }], konkan: true, konkanSpendsExecuted: 0 };
      if (i === 1) return { ...p, opened: true, melds: [targetMeld] };
      return p;
    }),
  };

  assert.equal(hasPlayerExecutedKonkanSpend(state, state.players[0].id), false);
  const result = spendTileOnMeld(state, 0, "spend-1", state.players[1].id, "target-run");

  assert.notEqual(result.players[0].eliminated, true);
  assert.equal(result.players[0].konkanSpendsExecuted, 1);
  assert.equal(hasPlayerExecutedKonkanSpend(result, result.players[0].id), true);
  assert.equal(result.players[1].melds[0].tiles.length, 4);
  assert.equal(result.currentPlayerIndex, 0); // Turn has not ended yet, player can still discard
});

test("KonKan player: 2nd spend via spendTileOnMeld immediately eliminates player mid-turn", () => {
  const okeyTile: OkeyTile = { id: "okey", color: "blue", value: 13, copy: 1 };
  const base = createInitialOkeyGame(0);
  const secondSpendTile: OkeyTile = { id: "spend-2", color: "black", value: 6, copy: 1 };
  const targetTiles: OkeyTile[] = [
    { id: "t-1", color: "black", value: 3, copy: 1 },
    { id: "t-2", color: "black", value: 4, copy: 1 },
    { id: "t-3", color: "black", value: 5, copy: 1 },
  ];
  const targetMeld: OkeyMeld = {
    id: "target-run-2",
    ownerId: base.players[1].id,
    kind: "run",
    tiles: targetTiles,
    score: 12,
  };

  const state: OkeyGameState = {
    ...base,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    okeyTile,
    players: base.players.map((p, i) => {
      if (i === 0) return {
        ...p,
        hand: [secondSpendTile, { id: "discard-candidate", color: "yellow", value: 10, copy: 1 }],
        konkan: true,
        konkanSpendsExecuted: 1, // Already executed 1 spend
      };
      if (i === 1) return { ...p, opened: true, melds: [targetMeld] };
      return p;
    }),
  };

  assert.equal(hasPlayerExecutedKonkanSpend(state, state.players[0].id), true);
  const result = spendTileOnMeld(state, 0, "spend-2", state.players[1].id, "target-run-2");

  // Immediate mid-turn elimination
  assert.equal(result.players[0].eliminated, true);
  // Spend tile did NOT stay on table; still in player's hand
  assert.deepEqual(result.players[0].hand.map((t) => t.id).sort(), ["discard-candidate", "spend-2"]);
  // Target meld remains unchanged on the table
  assert.equal(result.players[1].melds[0].tiles.length, 3);
  // Turn advanced immediately to the next counter-clockwise player
  assert.notEqual(result.currentPlayerIndex, 0);
  assert.equal(result.hasDrawnThisTurn, false);
});

test("Joker replacement after a real KonKan spend does not eliminate or consume another spend", () => {
  const okeyTile: OkeyTile = { id: "okey", color: "blue", value: 13, copy: 1 };
  const base = createInitialOkeyGame(0);
  const realTile: OkeyTile = { id: "real-tile", color: "red", value: 4, copy: 1 };
  const targetTiles: OkeyTile[] = [
    { id: "t-1", color: "red", value: 3, copy: 1 },
    { id: "joker-in-meld", color: "blue", value: 13, copy: 1 }, // Wildcard okey tile
    { id: "t-3", color: "red", value: 5, copy: 1 },
  ];
  const targetMeld: OkeyMeld = {
    id: "joker-run",
    ownerId: base.players[1].id,
    kind: "run",
    tiles: targetTiles,
    score: 12,
  };

  const state: OkeyGameState = {
    ...base,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    okeyTile,
    players: base.players.map((p, i) => {
      if (i === 0) return {
        ...p,
        hand: [realTile],
        konkan: true,
        konkanSpendsExecuted: 1,
      };
      if (i === 1) return { ...p, opened: true, melds: [targetMeld] };
      return p;
    }),
  };

  const result = spendTileOnMeld(state, 0, "real-tile", state.players[1].id, "joker-run");

  assert.notEqual(result.players[0].eliminated, true);
  assert.equal(result.players[0].konkanSpendsExecuted, 1);
  assert.equal(result.players[0].hand.some((tile) => tile.id === "joker-in-meld"), true);
  const replacementOnTable = result.players[1].melds[0].tiles.find((tile) => tile.id === "real-tile");
  assert.ok(replacementOnTable);
  assert.equal(replacementOnTable.spentByPlayerId, undefined);
  assert.equal(result.currentPlayerIndex, 0);
  assert.equal(result.hasDrawnThisTurn, true);
});

test("KonKan player: 1st Normal Meld/Open attempt immediately eliminates player mid-turn", () => {
  const okeyTile: OkeyTile = { id: "okey", color: "blue", value: 13, copy: 1 };
  const base = createInitialOkeyGame(0);

  // Hand with high score melds (>101)
  const meld1Tiles: OkeyTile[] = [
    { id: "r11", color: "red", value: 11, copy: 1 },
    { id: "r12", color: "red", value: 12, copy: 1 },
    { id: "r13", color: "red", value: 13, copy: 1 },
  ];
  const meld2Tiles: OkeyTile[] = [
    { id: "b11", color: "black", value: 11, copy: 1 },
    { id: "b12", color: "black", value: 12, copy: 1 },
    { id: "b13", color: "black", value: 13, copy: 1 },
  ];
  const meld3Tiles: OkeyTile[] = [
    { id: "y11", color: "yellow", value: 11, copy: 1 },
    { id: "y12", color: "yellow", value: 12, copy: 1 },
    { id: "y13", color: "yellow", value: 13, copy: 1 },
  ];
  const allHandTiles = [...meld1Tiles, ...meld2Tiles, ...meld3Tiles];

  const candidateMelds: OkeyMeld[] = [
    { id: "m1", ownerId: base.players[0].id, kind: "run", tiles: meld1Tiles, score: 36 },
    { id: "m2", ownerId: base.players[0].id, kind: "run", tiles: meld2Tiles, score: 36 },
    { id: "m3", ownerId: base.players[0].id, kind: "run", tiles: meld3Tiles, score: 36 },
  ];

  const state: OkeyGameState = {
    ...base,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    okeyTile,
    players: base.players.map((p, i) => {
      if (i === 0) return {
        ...p,
        hand: allHandTiles,
        konkan: true,
        konkanSpendsExecuted: 0,
      };
      return p;
    }),
  };

  // UI check: open action is NOT blocked
  const openAction = getOkeyOpenAction(state, 0, candidateMelds, []);
  assert.equal(openAction.allowed, true);
  assert.equal(openAction.mode, "open-melds");

  // Attempt to open normal melds
  const result = openPlayerMelds(state, 0, candidateMelds, 108);

  assert.equal(result.players[0].eliminated, true);
  assert.notEqual(result.currentPlayerIndex, 0);
  assert.equal(result.hasDrawnThisTurn, false);
});

test("KonKan player: open-and-discard via authoritative command eliminates player cleanly mid-turn", () => {
  const okeyTile: OkeyTile = { id: "okey", color: "blue", value: 13, copy: 1 };
  const base = createInitialOkeyGame(0);

  const meld1Tiles: OkeyTile[] = [
    { id: "r11", color: "red", value: 11, copy: 1 },
    { id: "r12", color: "red", value: 12, copy: 1 },
    { id: "r13", color: "red", value: 13, copy: 1 },
  ];
  const meld2Tiles: OkeyTile[] = [
    { id: "b11", color: "black", value: 11, copy: 1 },
    { id: "b12", color: "black", value: 12, copy: 1 },
    { id: "b13", color: "black", value: 13, copy: 1 },
  ];
  const meld3Tiles: OkeyTile[] = [
    { id: "y11", color: "yellow", value: 11, copy: 1 },
    { id: "y12", color: "yellow", value: 12, copy: 1 },
    { id: "y13", color: "yellow", value: 13, copy: 1 },
  ];
  const discardTile: OkeyTile = { id: "extra-discard", color: "red", value: 1, copy: 1 };
  const allHandTiles = [...meld1Tiles, ...meld2Tiles, ...meld3Tiles, discardTile];

  const candidateMelds: OkeyMeld[] = [
    { id: "m1", ownerId: base.players[0].id, kind: "run", tiles: meld1Tiles, score: 36 },
    { id: "m2", ownerId: base.players[0].id, kind: "run", tiles: meld2Tiles, score: 36 },
    { id: "m3", ownerId: base.players[0].id, kind: "run", tiles: meld3Tiles, score: 36 },
  ];

  const state: OkeyGameState = {
    ...base,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    okeyTile,
    players: base.players.map((p, i) => {
      if (i === 0) return {
        ...p,
        hand: allHandTiles,
        konkan: true,
      };
      return p;
    }),
  };

  const result = applyAuthoritativeOkeyCommand(state, 0, {
    type: "open-and-discard",
    tileId: "extra-discard",
    melds: candidateMelds,
    score: 108,
  });

  // Player eliminated
  assert.equal(result.players[0].eliminated, true);
  // Hand tiles remain in hand, extra-discard was not discarded to discard pile
  assert.equal(result.players[0].hand.length, 10);
  assert.equal(result.discardPile.some((t) => t.id === "extra-discard"), false);
  // Turn advanced immediately
  assert.notEqual(result.currentPlayerIndex, 0);
  assert.equal(result.hasDrawnThisTurn, false);
});
