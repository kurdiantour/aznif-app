import assert from "node:assert/strict";
import test from "node:test";

import { createInitialOkeyGame } from "../okey-engine.ts";
import { advanceTurn } from "../okeyengine-state-utils.ts";
import { applyAuthoritativeOkeyMatchCommand, createAuthoritativeOkeyMatch, resolveAuthoritativeMatchDeadline, settleAuthoritativeOkeyRound, startAuthoritativeOkeyNextRound } from "../../server/okey-authoritative.ts";
import { handSeatToBot, isOkeyBotControlled } from "../okey-bot-engine.ts";

test("one versus one deals two opposing seats and alternates turns", () => {
  const state = createInitialOkeyGame(0, () => 0.5, "1v1");
  assert.equal(state.mode, "1v1");
  assert.equal(state.players.length, 2);
  assert.deepEqual(state.players.map((player) => player.teamId), ["teamA", "teamB"]);
  assert.deepEqual(state.players.map((player) => player.hand.length), [15, 14]);
  assert.equal(advanceTurn(state).currentPlayerIndex, 1);
  assert.equal(advanceTurn(advanceTurn(state)).currentPlayerIndex, 0);
});

test("authoritative match preserves two real player identities", () => {
  const match = createAuthoritativeOkeyMatch([
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ], 1);
  assert.equal(match.roundState.mode, "1v1");
  assert.deepEqual(match.roundState.players.map((player) => player.id), ["alice", "bob"]);
  assert.equal(match.roundState.currentPlayerIndex, 1);
});

test("one versus one round scoring and takeover remain in the shared lifecycle", () => {
  const original = createAuthoritativeOkeyMatch([
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ], 0);
  const takenOver = {
    ...original,
    roundState: handSeatToBot(original.roundState, 1, "normal"),
  };
  assert.equal(isOkeyBotControlled(takenOver.roundState.players[1]), true);
  const settled = settleAuthoritativeOkeyRound({
    ...takenOver,
    roundState: {
      ...takenOver.roundState,
      phase: "finished",
      winnerId: "alice",
      endReason: "win",
    },
  });
  assert.equal(settled.roundResults.length, 1);
  assert.equal(settled.roundResults[0].winnerTeamId, "teamA");
  const next = startAuthoritativeOkeyNextRound(settled);
  assert.equal(next.roundState.mode, "1v1");
  assert.equal(next.roundState.players.length, 2);
  assert.equal(next.roundState.dealerIndex, 0);
  assert.equal(isOkeyBotControlled(next.roundState.players[1]), true);
});

test("one versus one uses authoritative discard and draw commands", () => {
  const match = createAuthoritativeOkeyMatch([
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ], 0);
  const discarded = applyAuthoritativeOkeyMatchCommand(match, 0, {
    type: "discard", tileId: match.roundState.players[0].hand[0].id,
  });
  assert.equal(discarded.roundState.currentPlayerIndex, 1);
  assert.equal(discarded.roundState.hasDrawnThisTurn, false);
  const drawn = applyAuthoritativeOkeyMatchCommand(discarded, 1, { type: "draw", source: "deck" });
  assert.equal(drawn.roundState.currentPlayerIndex, 1);
  assert.equal(drawn.roundState.hasDrawnThisTurn, true);
  assert.equal(drawn.roundState.players[1].hand.length, 15);
});

test("two missed draws give the same resumable bot ownership in one versus one", () => {
  let match = createAuthoritativeOkeyMatch([
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ], 0);
  const forceBobDraw = () => ({
    ...match,
    roundState: { ...match.roundState, currentPlayerIndex: 1, hasDrawnThisTurn: false },
  });
  const expired = "2026-08-02T00:00:00.000Z";
  const now = Date.parse("2026-08-02T00:01:00.000Z");
  match = resolveAuthoritativeMatchDeadline(forceBobDraw(), expired, now);
  match = resolveAuthoritativeMatchDeadline(forceBobDraw(), expired, now);
  assert.equal(match.timeoutCountsByPlayerId.bob, 2);
  assert.equal(isOkeyBotControlled(match.roundState.players[1]), true);
  assert.equal(match.matchFinished, false);
  assert.deepEqual(match.manualLeftPlayerIds, []);
  const reclaimed = applyAuthoritativeOkeyMatchCommand(match, 1, { type: "take-back-seat" });
  assert.equal(isOkeyBotControlled(reclaimed.roundState.players[1]), false);
  assert.equal(reclaimed.timeoutCountsByPlayerId.bob, 0);
});
