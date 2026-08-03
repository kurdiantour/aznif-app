import assert from "node:assert/strict";
import test from "node:test";

import { chooseBotDiscardTile, chooseBotDrawSource, prepareBotTurn } from "../okey-bot-engine.ts";
import { createInitialOkeyGame } from "../okey-engine.ts";
import type { OkeyGameState, OkeyTile } from "../../types/okey.ts";

function tile(id: string, color: OkeyTile["color"], value: number, copy: 1 | 2 = 1): OkeyTile {
  return { id, color, value, copy };
}

function botState(hand: OkeyTile[], discardPile: OkeyTile[] = []): OkeyGameState {
  const state = createInitialOkeyGame(1);
  return {
    ...state,
    currentPlayerIndex: 1,
    hasDrawnThisTurn: false,
    deck: [tile("deck-safe", "yellow", 13), ...state.deck],
    discardPile,
    discardOwners: discardPile.map(() => ({ playerIndex: 0, playerId: "human" })),
    okeyTile: tile("okey", "black", 13),
    players: state.players.map((player, index) => index === 1
      ? { ...player, hand, opened: true as const }
      : player),
  };
}

test("opened bot takes a visible discard that completes a run", () => {
  const hand = [
    tile("r5", "red", 5),
    tile("r6", "red", 6),
    tile("b2", "blue", 2),
    tile("y4", "yellow", 4),
  ];
  const state = botState(hand, [tile("r7", "red", 7)]);
  assert.equal(chooseBotDrawSource(state), "discard");
});

test("unopened bot does not enter Konkan for a merely useful discard", () => {
  const state = botState(
    [tile("r5", "red", 5), tile("r6", "red", 6), tile("b2", "blue", 2)],
    [tile("r7", "red", 7)],
  );
  state.players[1] = { ...state.players[1], opened: false };
  assert.equal(chooseBotDrawSource(state), "deck");
});

test("discard choice preserves completed and near-completed structures", () => {
  const isolated = tile("isolated", "yellow", 12);
  const state = botState([
    tile("r5", "red", 5),
    tile("r6", "red", 6),
    tile("r7", "red", 7),
    tile("b8", "blue", 8),
    tile("y8", "yellow", 8),
    isolated,
  ]);
  state.hasDrawnThisTurn = true;
  assert.equal(chooseBotDiscardTile(state)?.id, isolated.id);
});

test("prepared decisions are deterministic and preserve a discard tile", () => {
  const state = botState([
    tile("r5", "red", 5),
    tile("r6", "red", 6),
    tile("r7", "red", 7),
    tile("b3", "blue", 3),
  ]);
  const first = prepareBotTurn(state);
  const second = prepareBotTurn(state);
  assert.equal(first.discardTileId, second.discardTileId);
  assert.ok(first.discardTileId);
  assert.equal(first.state.currentPlayerIndex, 1);
  assert.equal(first.state.hasDrawnThisTurn, true);
});

test("bot opens high-scoring melds while keeping multiple loose tiles", () => {
  const meldTiles = ([
    ["red", 10], ["red", 11], ["red", 12],
    ["blue", 10], ["blue", 11], ["blue", 12],
    ["black", 10], ["black", 11], ["black", 12],
    ["yellow", 10], ["yellow", 11], ["yellow", 12],
  ] as const).map(([color, value], index) => tile(`meld-${index}`, color, value));
  const state = botState([
    ...meldTiles,
    tile("loose-a", "red", 2),
    tile("loose-b", "blue", 5),
    tile("loose-c", "black", 8),
  ]);
  state.hasDrawnThisTurn = true;
  state.players[1] = { ...state.players[1], opened: false };

  const prepared = prepareBotTurn(state);

  assert.equal(prepared.state.players[1].opened, true);
  assert.equal(prepared.decision.opened, true);
  assert.equal(prepared.state.players[1].melds.length, 4);
  assert.equal(prepared.state.players[1].hand.length, 3);
});

test("unopened bot takes a discard used in a valid partial-hand opening", () => {
  const state = botState([
    tile("r10", "red", 10), tile("r11", "red", 11),
    tile("b10", "blue", 10), tile("b11", "blue", 11), tile("b12", "blue", 12),
    tile("k10", "black", 10), tile("k11", "black", 11), tile("k12", "black", 12),
    tile("y10", "yellow", 10), tile("y11", "yellow", 11), tile("y12", "yellow", 12),
    tile("loose-a", "red", 2), tile("loose-b", "blue", 5),
  ], [tile("r12", "red", 12)]);
  state.players[1] = { ...state.players[1], opened: false };

  assert.equal(chooseBotDrawSource(state), "discard");
  const prepared = prepareBotTurn(state);
  assert.equal(prepared.state.players[1].opened, true);
  assert.equal(prepared.decision.opened, true);
});

test("KonKan bot locks a legal tile onto an opened table meld", () => {
  const targetTiles = [
    tile("target-7", "red", 7),
    tile("target-8", "red", 8),
    tile("target-9", "red", 9),
  ];
  const state = botState([tile("lock-10", "red", 10), tile("bot-loose", "blue", 2)]);
  state.hasDrawnThisTurn = true;
  state.players[1] = {
    ...state.players[1],
    opened: false,
    konkan: true,
    konkanEntryReason: "forced-table-add",
  };
  state.players[0] = {
    ...state.players[0],
    opened: true,
    melds: [{
      id: "target-run",
      ownerId: state.players[0].id,
      kind: "run",
      tiles: targetTiles,
      score: 24,
    }],
  };

  const prepared = prepareBotTurn(state);
  const lockedMeld = prepared.state.players[0].melds[0];

  assert.equal(lockedMeld.locked, true);
  assert.equal(lockedMeld.lockedByPlayerId, state.players[1].id);
  assert.equal(lockedMeld.lockedTileId, "lock-10");
});

test("closed bot never steals a joker and enters KonKan before opening", () => {
  const state = botState([
    tile("own-r3", "red", 3),
    tile("replacement-r4", "red", 4),
    tile("own-r5", "red", 5),
    tile("loose", "yellow", 1),
  ]);
  state.hasDrawnThisTurn = true;
  state.players[1] = { ...state.players[1], opened: false };
  state.players[0] = {
    ...state.players[0],
    opened: true,
    melds: [{
      id: "joker-run",
      ownerId: state.players[0].id,
      kind: "run",
      tiles: [tile("table-r3", "red", 3), { ...state.okeyTile, id: "table-joker" }, tile("table-r5", "red", 5)],
      score: 12,
    }],
  };

  const prepared = prepareBotTurn(state);
  assert.equal(prepared.decision.spentTileIds.includes("replacement-r4"), false);
  assert.equal(prepared.state.players[1].konkan, false);
});

test("opened bot can replace and steal a joker", () => {
  const state = botState([
    tile("replacement-r4-opened", "red", 4),
    tile("opened-loose", "yellow", 1),
  ]);
  state.hasDrawnThisTurn = true;
  state.players[0] = {
    ...state.players[0],
    opened: true,
    melds: [{
      id: "opened-joker-run",
      ownerId: state.players[0].id,
      kind: "run",
      tiles: [tile("opened-r3", "red", 3), { ...state.okeyTile, id: "opened-table-joker" }, tile("opened-r5", "red", 5)],
      score: 12,
    }],
  };

  const prepared = prepareBotTurn(state);
  assert.equal(prepared.decision.spentTileIds.includes("replacement-r4-opened"), true);
  assert.equal(prepared.state.players[1].konkan, false);
  assert.equal(prepared.state.players[0].melds[0].tiles.some((entry) => entry.id === "replacement-r4-opened"), true);
});
