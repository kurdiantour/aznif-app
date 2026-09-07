import assert from "node:assert/strict";
import test from "node:test";

import {
  createBotPostDrawActionEvents,
  createOkeyCommandActionEvents,
} from "../okey-action-events.ts";
import { createInitialOkeyGame } from "../../engine/okey-engine.ts";

test("human composite actions preserve presentation order", () => {
  const events = createOkeyCommandActionEvents(
    {
      type: "open-and-discard",
      melds: [],
      score: 101,
      tileId: "tile-1",
    },
    "human-1",
  );

  assert.deepEqual(events.map((event) => event.type), ["open", "discard"]);
  assert.equal(events[1]?.payload.tileId, "tile-1");
});

test("Bot actions use the same event types and keep discard last", () => {
  const events = createBotPostDrawActionEvents({
    actorPlayerId: "bot-1",
    declaredKonkan: true,
    openedMelds: [],
    spentTileIds: ["tile-2"],
    discardedTile: { id: "tile-3", color: "red", value: 7, copy: 1 },
  });

  assert.deepEqual(events.map((event) => event.type), ["konkan", "meld", "discard"]);
  assert.ok(events.every((event) => event.actorPlayerId === "bot-1"));
});
test("authoritative KonKan declaration event carries the complete reveal", () => {
  const base = createInitialOkeyGame(0);
  const actor = base.players[base.currentPlayerIndex];
  const runTiles = actor.hand.slice(0, 10);
  const completionMeldTiles = actor.hand.slice(10, 14);
  const discardTile = actor.hand[14];
  const events = createOkeyCommandActionEvents({
    type: "declare-konkan",
    orderedRunTileIds: runTiles.map((tile) => tile.id),
    completionMeldTileIds: completionMeldTiles.map((tile) => tile.id),
    discardTileId: discardTile.id,
  }, actor.id, base);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "konkan");
  assert.equal(events[0].payload.kind, "declare");
  assert.deepEqual(events[0].payload.runTiles, runTiles);
  assert.deepEqual(events[0].payload.completionMeldTiles, completionMeldTiles);
  assert.deepEqual(events[0].payload.discardTile, discardTile);
});
