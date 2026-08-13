import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createInitialOkeyGame } from "../../engine/okey-engine.ts";
import {
  applyAuthoritativeOkeyCommand,
  applyAuthoritativeOkeyMatchCommand,
  applyAuthoritativeManualLeave,
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
  OkeyCommandError,
  projectOkeyPublicState,
  projectOkeyState,
  resolveAuthoritativeDeadline,
  resolveAuthoritativeMatchDeadline,
  settleAuthoritativeOkeyRound,
} from "../okey-authoritative.ts";
import { handSeatToBot, isOkeyBotControlled } from "../../engine/okey-bot-policy.ts";

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
const matchPlayers = [
  { id: "player-0", name: "Player 0" },
  { id: "player-1", name: "Player 1" },
  { id: "player-2", name: "Player 2" },
  { id: "player-3", name: "Player 3" },
] as const;

const expiredDeadline = "2026-08-02T00:00:00.000Z";
const afterDeadline = Date.parse("2026-08-02T00:01:00.000Z");

function forcePlayerTurn(
  match: ReturnType<typeof createAuthoritativeOkeyMatch>,
  playerIndex: number,
) {
  return {
    ...match,
    roundState: {
      ...match.roundState,
      currentPlayerIndex: playerIndex,
      hasDrawnThisTurn: false,
    },
  };
}

test("first missed turn auto-draws and discards that exact tile with streak one", () => {
  const initial = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = 1;
  const match = forcePlayerTurn(initial, playerIndex);
  const playerId = match.roundState.players[playerIndex].id;
  const drawnTileId = match.roundState.deck[0].id;

  const next = resolveAuthoritativeMatchDeadline(match, expiredDeadline, afterDeadline);

  assert.equal(next.timeoutCountsByPlayerId[playerId], 1);
  assert.equal(next.roundState.discardPile.at(-1)?.id, drawnTileId);
  assert.equal(next.roundState.players[playerIndex].hand.some((tile) => tile.id === drawnTileId), false);
  assert.notEqual(next.roundState.currentPlayerIndex, playerIndex);
});

test("second consecutive missed turn repeats exact auto-discard and reaches streak two", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = match.roundState.currentPlayerIndex;
  const playerId = match.roundState.players[playerIndex].id;

  match = resolveAuthoritativeMatchDeadline(match, expiredDeadline, afterDeadline);
  match = forcePlayerTurn(match, playerIndex);
  const drawnTileId = match.roundState.deck[0].id;
  match = resolveAuthoritativeMatchDeadline(match, expiredDeadline, afterDeadline);

  assert.equal(match.timeoutCountsByPlayerId[playerId], 2);
  assert.equal(match.roundState.discardPile.at(-1)?.id, drawnTileId);
  assert.equal(isOkeyBotControlled(match.roundState.players[playerIndex]), false);
});

test("the turn after two misses starts with immediate bot takeover and no third human timer", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = 1;
  match = forcePlayerTurn(match, playerIndex);
  const originalPlayer = match.roundState.players[playerIndex];

  match = resolveAuthoritativeMatchDeadline(match, expiredDeadline, afterDeadline);
  match = resolveAuthoritativeMatchDeadline(forcePlayerTurn(match, playerIndex), expiredDeadline, afterDeadline);
  assert.equal(match.timeoutCountsByPlayerId[originalPlayer.id], 2);
  assert.throws(
    () => applyAuthoritativeOkeyMatchCommand(forcePlayerTurn(match, playerIndex), playerIndex, { type: "draw", source: "deck" }),
    (error) => error instanceof OkeyCommandError && error.code === "command_rejected",
  );

  const precedingIndex = 0;
  match = forcePlayerTurn(match, precedingIndex);
  match = {
    ...match,
    roundState: { ...match.roundState, hasDrawnThisTurn: true },
  };
  const discardId = match.roundState.players[precedingIndex].hand[0].id;
  match = applyAuthoritativeOkeyMatchCommand(match, precedingIndex, { type: "discard", tileId: discardId });

  const controlledPlayer = match.roundState.players[playerIndex];
  assert.equal(match.timeoutCountsByPlayerId[originalPlayer.id], 2);
  assert.equal(isOkeyBotControlled(controlledPlayer), true);
  assert.equal(controlledPlayer.id, originalPlayer.id);
  assert.equal(controlledPlayer.teamId, originalPlayer.teamId);
  assert.equal(controlledPlayer.kind, "bot");
  assert.match(controlledPlayer.name, /^Bot [3-9]\d{2}$/);
  assert.notEqual(controlledPlayer.name, originalPlayer.name);
  assert.ok((controlledPlayer.botNumber ?? 0) >= 300);
  assert.notEqual(match.roundState.currentPlayerIndex, playerIndex);
  assert.deepEqual(match.manualLeftPlayerIds, []);
  assert.equal(match.pendingForfeitTeamId, null);
  assert.equal(match.leaveTerminationReason, null);
  assert.equal(getNextOkeyMatchTurnDeadline(forcePlayerTurn(match, playerIndex)), null);
});

test("timeout takeover never becomes manual leave, forfeit, or no-humans", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = 0;
  const playerId = match.roundState.players[playerIndex].id;
  match = {
    ...forcePlayerTurn(match, playerIndex),
    timeoutCountsByPlayerId: { ...match.timeoutCountsByPlayerId, [playerId]: 1 },
  };

  const takenOver = resolveAuthoritativeMatchDeadline(match, expiredDeadline, afterDeadline);

  assert.equal(takenOver.timeoutCountsByPlayerId[playerId], 2);
  assert.deepEqual(takenOver.manualLeftPlayerIds, []);
  assert.equal(takenOver.pendingForfeitTeamId, null);
  assert.equal(takenOver.leaveTerminationReason, null);
});
test("manual leave finalizes an already bot-controlled takeover seat", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = 1;
  match = forcePlayerTurn(match, playerIndex);
  const originalPlayerId = match.roundState.players[playerIndex].id;

  match = resolveAuthoritativeMatchDeadline(match, expiredDeadline, afterDeadline);
  match = resolveAuthoritativeMatchDeadline(
    forcePlayerTurn(match, playerIndex),
    expiredDeadline,
    afterDeadline,
  );

  const precedingIndex = 0;
  match = forcePlayerTurn(match, precedingIndex);
  match = {
    ...match,
    roundState: { ...match.roundState, hasDrawnThisTurn: true },
  };
  const discardId = match.roundState.players[precedingIndex].hand[0].id;
  match = applyAuthoritativeOkeyMatchCommand(match, precedingIndex, {
    type: "discard",
    tileId: discardId,
  });

  const botBeforeFinalLeave = match.roundState.players[playerIndex];
  assert.equal(isOkeyBotControlled(botBeforeFinalLeave), true);

  const finalized = applyAuthoritativeManualLeave(match, playerIndex);

  assert.ok(finalized.manualLeftPlayerIds.includes(originalPlayerId));
  assert.strictEqual(finalized.roundState.players[playerIndex], botBeforeFinalLeave);
});
test("a valid human move resets consecutive timeout counts", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  match = resolveAuthoritativeMatchDeadline(
    match,
    expiredDeadline,
    afterDeadline,
  );

  assert.equal(match.timeoutCountsByPlayerId["player-0"], 1);

  match = forcePlayerTurn(match, 0);
  match = {
    ...match,
    roundState: {
      ...match.roundState,
      hasDrawnThisTurn: true,
    },
  };

  const tileId = match.roundState.players[0].hand[0].id;
  const moved = applyAuthoritativeOkeyMatchCommand(
    match,
    0,
    { type: "discard", tileId },
  );

  assert.equal(moved.timeoutCountsByPlayerId["player-0"], 0);

  const timedOutAgain = resolveAuthoritativeMatchDeadline(
    forcePlayerTurn(moved, 0),
    expiredDeadline,
    afterDeadline,
  );

  assert.equal(timedOutAgain.timeoutCountsByPlayerId["player-0"], 1);
  assert.equal(
    isOkeyBotControlled(timedOutAgain.roundState.players[0]),
    false,
  );
});
test("manual leave preserves the seat state and bot control across rounds", () => {
  const match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const leavingPlayer = match.roundState.players[1];
  const handIds = leavingPlayer.hand.map((tile) => tile.id);
  const melds = leavingPlayer.melds;

  const left = applyAuthoritativeManualLeave(match, 1);
  const controlledPlayer = left.roundState.players[1];

  assert.deepEqual(left.manualLeftPlayerIds, [leavingPlayer.id]);
  assert.equal(left.pendingForfeitTeamId, null);
  assert.equal(isOkeyBotControlled(controlledPlayer), true);
  assert.equal(controlledPlayer.id, leavingPlayer.id);
  assert.equal(controlledPlayer.teamId, leavingPlayer.teamId);
  assert.deepEqual(controlledPlayer.hand.map((tile) => tile.id), handIds);
  assert.deepEqual(controlledPlayer.melds, melds);

  const nextRound = settleAuthoritativeOkeyRound({
    ...left,
    roundState: {
      ...left.roundState,
      phase: "finished",
      winnerId: left.roundState.players[0].id,
      endReason: "win",
    },
  });

  assert.equal(nextRound.matchFinished, false);
  assert.equal(
    isOkeyBotControlled(nextRound.roundState.players[1]),
    true,
  );

  assert.equal(nextRound.roundState.players[1].name, controlledPlayer.name);
  assert.equal(nextRound.roundState.players[1].botNumber, controlledPlayer.botNumber);
  assert.equal(nextRound.roundState.players[1].kind, "bot");});

test("a whole-team leave finishes the match after the current round", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  match = applyAuthoritativeManualLeave(match, 1);
  match = applyAuthoritativeManualLeave(match, 3);

  assert.equal(match.pendingForfeitTeamId, "teamB");
  assert.equal(isOkeyBotControlled(match.roundState.players[1]), true);
  assert.equal(isOkeyBotControlled(match.roundState.players[3]), true);
  assert.equal(match.matchFinished, false);
  assert.equal(match.leaveTerminationReason, "team-forfeit");

  const finished = settleAuthoritativeOkeyRound({
    ...match,
    roundState: {
      ...match.roundState,
      phase: "finished",
      winnerId: match.roundState.players[1].id,
      endReason: "win",
    },
  });

  assert.equal(finished.matchFinished, true);
  assert.equal(finished.matchWinnerTeamId, "teamA");
  assert.equal(finished.currentRound, 1);
  assert.equal(finished.roundResults.length, 1);
  assert.equal(finished.roundState.phase, "finished");
});

test("manual leave remains intentional while a teammate timeout stays non-forfeiting", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  match = applyAuthoritativeManualLeave(match, 1);
  match = {
    ...forcePlayerTurn(match, 3),
    timeoutCountsByPlayerId: { ...match.timeoutCountsByPlayerId, "player-3": 1 },
  };

  match = resolveAuthoritativeMatchDeadline(match, expiredDeadline, afterDeadline);

  assert.deepEqual(match.manualLeftPlayerIds, ["player-1"]);
  assert.equal(match.pendingForfeitTeamId, null);
  assert.equal(match.leaveTerminationReason, null);
});

test("two timeout takeovers on one team do not create a team forfeit", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  match = {
    ...match,
    roundState: handSeatToBot(match.roundState, 1, "normal"),
    timeoutCountsByPlayerId: { ...match.timeoutCountsByPlayerId, "player-1": 2, "player-3": 1 },
  };
  match = resolveAuthoritativeMatchDeadline(forcePlayerTurn(match, 3), expiredDeadline, afterDeadline);

  assert.equal(isOkeyBotControlled(match.roundState.players[1]), true);
  assert.deepEqual(match.manualLeftPlayerIds, []);
  assert.equal(match.pendingForfeitTeamId, null);
  assert.equal(match.leaveTerminationReason, null);
});
test("round three completes before the sole remaining human wins and round four is not created", () => {
  let match = {
    ...createAuthoritativeOkeyMatch(matchPlayers, 0),
    currentRound: 3,
  };
  match = applyAuthoritativeManualLeave(match, 1);
  match = applyAuthoritativeManualLeave(match, 2);
  match = applyAuthoritativeManualLeave(match, 3);

  assert.equal(match.matchFinished, false);
  assert.equal(match.matchWinnerTeamId, null);
  assert.equal(match.leaveTerminationReason, "team-forfeit");
  assert.deepEqual([...match.manualLeftPlayerIds].sort(), ["player-1", "player-2", "player-3"]);
  assert.equal(isOkeyBotControlled(match.roundState.players[0]), false);
  assert.equal(isOkeyBotControlled(match.roundState.players[1]), true);
  assert.equal(isOkeyBotControlled(match.roundState.players[2]), true);
  assert.equal(isOkeyBotControlled(match.roundState.players[3]), true);
  assert.ok(getNextOkeyMatchTurnDeadline(match));

  const finished = settleAuthoritativeOkeyRound({
    ...match,
    roundState: {
      ...match.roundState,
      phase: "finished",
      winnerId: match.roundState.players[2].id,
      endReason: "win",
    },
  });

  assert.equal(finished.matchFinished, true);
  assert.equal(finished.matchWinnerTeamId, match.roundState.players[0].teamId);
  assert.equal(finished.currentRound, 3);
  assert.equal(finished.roundResults.at(-1)?.round, 3);
  assert.equal(finished.roundState.phase, "finished");
  assert.equal(getNextOkeyMatchTurnDeadline(finished), null);
});

test("zero remaining humans terminate immediately without winner or bot continuation", () => {
  const initial = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const prepared = {
    ...initial,
    manualLeftPlayerIds: ["player-0", "player-1", "player-2"],
    roundState: [0, 1, 2].reduce(
      (state, playerIndex) => handSeatToBot(state, playerIndex, "normal"),
      initial.roundState,
    ),
  };

  const finished = applyAuthoritativeManualLeave(prepared, 3);

  assert.equal(finished.matchFinished, true);
  assert.equal(finished.matchWinnerTeamId, null);
  assert.equal(finished.leaveTerminationReason, "no-humans");
  assert.equal(getNextOkeyMatchTurnDeadline(finished), null);
  assert.equal(finished.roundState.currentPlayerIndex, initial.roundState.currentPlayerIndex);
});

test("heartbeat and disconnected presence alone cannot trigger Okey takeover", () => {
  const maintenance = readFileSync("supabase/functions/okey_maintenance/index.ts", "utf8");
  const roomGateway = readFileSync("supabase/functions/okey_room/index.ts", "utf8");

  assert.doesNotMatch(maintenance, /connected|last_seen_at|heartbeat/i);
  assert.doesNotMatch(roomGateway, /handSeatToBot|timeoutCountsByPlayerId|bot.takeover/i);

  const match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  assert.ok(match.roundState.players.every((player) => !isOkeyBotControlled(player)));
});
