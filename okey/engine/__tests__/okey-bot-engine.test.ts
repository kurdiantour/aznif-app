import assert from "node:assert/strict";
import test from "node:test";

import { chooseBotDiscardTile, chooseBotDrawSource, playBotTurn, prepareBotTurn } from "../okey-bot-engine.ts";
import { createInitialOkeyGame, drawTile } from "../okey-engine.ts";
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
      ? { ...player, kind: "bot" as const, hand, opened: true as const }
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

test("authoritative Bot progression can commit Draw before Discard", () => {
  const state = botState([
    tile("r5", "red", 5),
    tile("r6", "red", 6),
    tile("r7", "red", 7),
    tile("b3", "blue", 3),
  ]);
  const actorId = state.players[state.currentPlayerIndex].id;

  const afterDraw = drawTile(state, chooseBotDrawSource(state));

  assert.equal(afterDraw.currentPlayerIndex, state.currentPlayerIndex);
  assert.equal(afterDraw.players[afterDraw.currentPlayerIndex].id, actorId);
  assert.equal(afterDraw.hasDrawnThisTurn, true);

  const afterDiscard = playBotTurn(afterDraw);

  assert.equal(afterDiscard.hasDrawnThisTurn, false);
  assert.notEqual(afterDiscard.currentPlayerIndex, state.currentPlayerIndex);
  assert.equal(afterDiscard.discardPile.length, afterDraw.discardPile.length + 1);
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

test("closed bot never steals a joker before opening", () => {
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
  assert.equal(prepared.state.players[0].melds[0].tiles.some((entry) => entry.id === "table-joker"), true);
});

test("closed bot does not spend on a table meld or enter Konkan", () => {
  const state = botState([
    tile("closed-spend-r10", "red", 10),
    tile("closed-loose", "yellow", 1),
  ]);
  state.hasDrawnThisTurn = true;
  state.players[1] = { ...state.players[1], opened: false, konkan: false };
  state.players[0] = {
    ...state.players[0],
    opened: true,
    melds: [{
      id: "closed-target-run",
      ownerId: state.players[0].id,
      kind: "run",
      tiles: [tile("closed-table-r7", "red", 7), tile("closed-table-r8", "red", 8), tile("closed-table-r9", "red", 9)],
      score: 24,
    }],
  };

  const prepared = prepareBotTurn(state);

  assert.equal(prepared.decision.spentTileIds.length, 0);
  assert.equal(prepared.state.players[1].konkan, false);
  assert.equal(prepared.state.players[1].hand.some((entry) => entry.id === "closed-spend-r10"), true);
  assert.equal(prepared.state.players[0].melds[0].tiles.length, 3);
});
test("opened bot prefers stealing a joker over an earlier ordinary table spend", () => {
  const state = botState([
    tile("replacement-red-4-priority", "red", 4),
    tile("priority-loose", "yellow", 1),
  ]);
  state.hasDrawnThisTurn = true;
  state.players[1] = {
    ...state.players[1],
    melds: [{
      id: "earlier-own-set",
      ownerId: state.players[1].id,
      kind: "set",
      tiles: [
        tile("own-blue-4", "blue", 4),
        tile("own-black-4", "black", 4),
        tile("own-yellow-4", "yellow", 4),
      ],
      score: 12,
    }],
  };
  state.players[0] = {
    ...state.players[0],
    opened: true,
    melds: [{
      id: "later-joker-run",
      ownerId: state.players[0].id,
      kind: "run",
      tiles: [
        tile("later-red-3", "red", 3),
        { ...state.okeyTile, id: "later-table-joker" },
        tile("later-red-5", "red", 5),
      ],
      score: 12,
    }],
  };

  const prepared = prepareBotTurn(state, { difficulty: "hard" });

  assert.equal(
    prepared.state.players[0].melds[0].tiles.some((entry) => entry.id === "replacement-red-4-priority"),
    true,
  );
  assert.equal(
    prepared.state.players[0].melds[0].tiles.some((entry) => entry.id === "later-table-joker"),
    false,
  );
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

test("opened bot takes a visible discard that completes a same-number group", () => {
  const state = botState([
    tile("red-8", "red", 8),
    tile("blue-8", "blue", 8),
    tile("run-3", "black", 3),
    tile("run-4", "black", 4),
  ], [tile("yellow-8", "yellow", 8)]);

  assert.equal(chooseBotDrawSource(state, { difficulty: "hard" }), "discard");
  const prepared = prepareBotTurn(state, { difficulty: "hard" });
  assert.equal(prepared.decision.drawSource, "discard");
  assert.notEqual(prepared.discardTileId, "yellow-8");
});

test("opened bot reuses a legally stolen joker before discarding the loose tile", () => {
  const state = botState([
    tile("exact-red-4", "red", 4),
    tile("weak-yellow-1", "yellow", 1),
  ]);
  state.hasDrawnThisTurn = true;
  state.players[0] = {
    ...state.players[0],
    opened: true,
    melds: [{
      id: "stealable-joker-run",
      ownerId: state.players[0].id,
      kind: "run",
      tiles: [tile("table-red-3", "red", 3), { ...state.okeyTile, id: "valuable-joker" }, tile("table-red-5", "red", 5)],
      score: 12,
    }],
  };

  const prepared = prepareBotTurn(state, { difficulty: "hard" });
  const bot = prepared.state.players[1];
  assert.equal(bot.hand.some((entry) => entry.id === "valuable-joker"), false);
  assert.equal(prepared.decision.spentTileIds.includes("exact-red-4"), true);
  assert.equal(prepared.decision.spentTileIds.includes("valuable-joker"), true);
  assert.equal(prepared.discardTileId, "weak-yellow-1");
});

test("opened bot re-evaluates a stolen joker and spends it on another legal meld", () => {
  const state = botState([
    tile("replacement-red-4", "red", 4),
    tile("loose-yellow-1", "yellow", 1),
  ]);
  state.hasDrawnThisTurn = true;
  state.players[0] = {
    ...state.players[0],
    opened: true,
    melds: [{
      id: "joker-run",
      ownerId: state.players[0].id,
      kind: "run",
      tiles: [tile("table-red-3", "red", 3), { ...state.okeyTile, id: "reusable-joker" }, tile("table-red-5", "red", 5)],
      score: 12,
    }, {
      id: "target-set",
      ownerId: state.players[0].id,
      kind: "set",
      tiles: [tile("target-red-7", "red", 7), tile("target-blue-7", "blue", 7), tile("target-yellow-7", "yellow", 7)],
      score: 21,
    }],
  };

  const prepared = prepareBotTurn(state, { difficulty: "hard" });

  assert.deepEqual(prepared.decision.spentTileIds.slice(0, 2), ["replacement-red-4", "reusable-joker"]);
  assert.equal(prepared.state.players[0].melds[1].tiles.some((entry) => entry.id === "reusable-joker"), true);
  assert.equal(prepared.state.players[1].hand.some((entry) => entry.id === "reusable-joker"), false);
  assert.equal(prepared.discardTileId, "loose-yellow-1");
});
test("opened bot spends a legal table tile, preserves a useful pair, and discards the weakest tile", () => {
  const state = botState([
    tile("spend-red-10", "red", 10),
    tile("keep-blue-5", "blue", 5),
    tile("keep-blue-6", "blue", 6),
    tile("weak-yellow-12", "yellow", 12),
  ]);
  state.hasDrawnThisTurn = true;
  state.players[0] = {
    ...state.players[0],
    opened: true,
    melds: [{
      id: "table-red-run",
      ownerId: state.players[0].id,
      kind: "run",
      tiles: [tile("table-red-7", "red", 7), tile("table-red-8", "red", 8), tile("table-red-9", "red", 9)],
      score: 24,
    }],
  };

  const prepared = prepareBotTurn(state, { difficulty: "hard" });
  assert.equal(prepared.decision.spentTileIds.includes("spend-red-10"), true);
  assert.equal(prepared.discardTileId, "weak-yellow-12");
  assert.ok(prepared.state.players[1].hand.some((entry) => entry.id === "keep-blue-5"));
  assert.ok(prepared.state.players[1].hand.some((entry) => entry.id === "keep-blue-6"));
});