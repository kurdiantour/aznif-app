import assert from "node:assert/strict";
import test from "node:test";

import {
  createBotPostDrawActionEvents,
  createOkeyCommandActionEvents,
} from "../okey-action-events.ts";

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