import assert from "node:assert/strict";
import test from "node:test";

import { createInitialOkeyGame } from "../../engine/okey-engine.ts";
import {
  applyAuthoritativeOkeyCommand,
  OkeyCommandError,
  projectOkeyPublicState,
  projectOkeyState,
  resolveAuthoritativeDeadline,
} from "../okey-authoritative.ts";

test("viewer projection exposes only the viewer hand and never the deck", () => {
  const state = createInitialOkeyGame(0);
  const projection = projectOkeyState(state, 2, 7, "2026-08-02T12:00:00.000Z");

  assert.equal("deck" in projection, false);
  assert.equal(projection.deckCount, state.deck.length);
  assert.deepEqual(projection.players[2].hand, state.players[2].hand);
  assert.equal(projection.players[0].hand, undefined);
  assert.equal(projection.players[1].hand, undefined);
  assert.equal(projection.players[3].hand, undefined);
});

test("public projection exposes no private hand", () => {
  const projection = projectOkeyPublicState(createInitialOkeyGame(1), 0, null);
  assert.ok(projection.players.every((player) => player.hand === undefined));
});

test("actor identity comes from the authenticated seat, not the command", () => {
  const state = createInitialOkeyGame(0);
  assert.throws(
    () => applyAuthoritativeOkeyCommand(state, (state.currentPlayerIndex + 1) % 4, { type: "draw", source: "deck" }),
    (error) => error instanceof OkeyCommandError && error.code === "not_your_turn",
  );
});

test("invalid engine moves are rejected instead of being committed", () => {
  const state = createInitialOkeyGame(0);
  assert.throws(
    () => applyAuthoritativeOkeyCommand(state, state.currentPlayerIndex, { type: "discard", tileId: "foreign-tile" }),
    (error) => error instanceof OkeyCommandError && error.code === "command_rejected",
  );
});

test("expired deadline is resolved by the server and advances the turn", () => {
  const state = createInitialOkeyGame(0);
  const next = resolveAuthoritativeDeadline(state, "2026-08-02T00:00:00.000Z", Date.parse("2026-08-02T00:01:00.000Z"));
  assert.notEqual(next, state);
  assert.notEqual(next.currentPlayerIndex, state.currentPlayerIndex);
});
