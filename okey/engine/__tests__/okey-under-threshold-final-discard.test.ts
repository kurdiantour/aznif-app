import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialOkeyGame,
  getOkeyOpenAction,
  getOkeyRackDiscardAction,
  getRequiredOpenScore,
} from "../okey-engine.ts";
import { applyAuthoritativeOkeyCommand } from "../../server/okey-authoritative.ts";
import type { OkeyGameState, OkeyMeld, OkeyTile } from "../../types/okey.ts";

function tile(value: number, id = `red-${value}`): OkeyTile {
  return { id, color: "red", value, copy: 1 };
}

function unopenedNormalState(): { state: OkeyGameState; meld: OkeyMeld; discard: OkeyTile } {
  const initial = createInitialOkeyGame(0);
  const meldTiles = [tile(3), tile(4), tile(5)];
  const discard = tile(12, "discard");
  const state: OkeyGameState = {
    ...initial,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    okeyTile: { id: "okey", color: "blue", value: 13, copy: 1 },
    players: initial.players.map((player, index) => index === 0
      ? {
          ...player,
          hand: [...meldTiles, discard],
          opened: false,
          melds: [],
          scoreOpened: 0,
          firstOpenScore: null,
          konkan: false,
          konkanEntryReason: null,
        }
      : player),
  };
  return {
    state,
    meld: { id: "staged", ownerId: state.players[0].id, kind: "run", tiles: meldTiles, score: 12 },
    discard,
  };
}

test("a normal player burns only on final discard when staged opening is below the engine threshold", () => {
  const { state, meld, discard } = unopenedNormalState();
  assert.ok(meld.score < getRequiredOpenScore(state, 0));

  const stagedAction = getOkeyOpenAction(state, 0, [meld], []);
  assert.equal(stagedAction.allowed, false);
  assert.equal(state.players[0].eliminated, undefined);
  assert.equal(state.players[0].konkan, false);

  const finalAction = getOkeyRackDiscardAction(state, 0, [meld], discard.id);
  assert.equal(finalAction.type, "open-and-discard");
  if (finalAction.type !== "open-and-discard") return;

  const result = applyAuthoritativeOkeyCommand(state, 0, finalAction);
  assert.equal(result.players[0].eliminated, true);
  assert.equal(result.players[0].opened, false);
  assert.equal(result.players[0].konkan, false);
  assert.equal(result.players[0].konkanEntryReason, null);
  assert.notEqual(result.currentPlayerIndex, 0);
});