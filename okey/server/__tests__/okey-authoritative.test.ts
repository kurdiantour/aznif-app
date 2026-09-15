import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createInitialOkeyGame } from "../../engine/okey-engine.ts";
import {
  applyAuthoritativeOkeyCommand,
  applyAuthoritativeOkeyMatchCommand,
  applyAuthoritativeOkeyEliminatedTurn,
  applyAuthoritativeManualLeave,
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
  getOkeyMatchTurnDeadlineAfterTransition,
  OKEY_DRAW_PHASE_SECONDS,
  OKEY_THROW_PHASE_SECONDS,
  OkeyCommandError,
  projectOkeyPublicState,
  projectOkeyState,
  resolveAuthoritativeDeadline,
  resolveAuthoritativeMatchDeadline,
  settleAuthoritativeOkeyRound,
  startAuthoritativeOkeyNextRound,
} from "../okey-authoritative.ts";
import { handSeatToBot, isOkeyBotControlled } from "../../engine/okey-bot-engine.ts";

test("viewer projection exposes only the viewer hand and never the deck", () => {
  const state = createInitialOkeyGame(0);
  const projection = projectOkeyState(state, 2, 7, "2026-08-02T12:00:00.000Z");

  assert.equal("deck" in projection, false);
  assert.equal(projection.deckCount, state.deck.length);
  assert.deepEqual(projection.players[2].hand, state.players[2].hand);
  assert.equal(projection.players[0].hand, undefined);
  assert.equal(projection.players[1].hand, undefined);
  assert.equal(projection.players[3].hand, undefined);
  assert.equal(projection.turnDurationSeconds, 30);

  const drawProjection = projectOkeyState(
    { ...state, hasDrawnThisTurn: false },
    2,
    8,
    "2026-08-02T12:00:15.000Z",
  );
  assert.equal(drawProjection.turnDurationSeconds, 15);
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

test("Okey deadlines are phase-aware: Draw is 15 seconds and Throw is 30 seconds", () => {
  const initial = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const now = Date.parse("2026-08-02T00:00:00.000Z");
  const drawPhase = {
    ...initial,
    roundState: { ...initial.roundState, hasDrawnThisTurn: false },
  };

  assert.equal(OKEY_DRAW_PHASE_SECONDS, 15);
  assert.equal(OKEY_THROW_PHASE_SECONDS, 30);
  assert.equal(getNextOkeyMatchTurnDeadline(drawPhase, now), "2026-08-02T00:00:15.000Z");
  assert.equal(getNextOkeyMatchTurnDeadline(initial, now), "2026-08-02T00:00:30.000Z");
});

test("a successful Human draw starts a fresh 30-second Throw deadline", () => {
  const initial = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const drawPhase = {
    ...initial,
    roundState: { ...initial.roundState, hasDrawnThisTurn: false },
  };
  const drawDeadline = "2026-08-02T00:00:15.000Z";
  const drawCommittedAt = Date.parse("2026-08-02T00:00:10.000Z");
  const afterDraw = applyAuthoritativeOkeyMatchCommand(
    drawPhase,
    drawPhase.roundState.currentPlayerIndex,
    { type: "draw", source: "deck" },
    drawCommittedAt,
  );

  assert.equal(
    getOkeyMatchTurnDeadlineAfterTransition(drawPhase, afterDraw, drawDeadline, drawCommittedAt),
    "2026-08-02T00:00:40.000Z",
  );
});

test("commands within one timer phase preserve its deadline and a player change starts Draw time", () => {
  const initial = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const currentDeadline = "2026-08-02T00:00:30.000Z";
  const later = Date.parse("2026-08-02T00:00:10.000Z");

  assert.equal(
    getOkeyMatchTurnDeadlineAfterTransition(initial, initial, currentDeadline, later),
    currentDeadline,
  );

  const nextPlayerIndex = (initial.roundState.currentPlayerIndex + 1) % initial.roundState.players.length;
  const nextTurn = {
    ...initial,
    roundState: {
      ...initial.roundState,
      currentPlayerIndex: nextPlayerIndex,
      hasDrawnThisTurn: false,
    },
  };
  assert.equal(
    getOkeyMatchTurnDeadlineAfterTransition(initial, nextTurn, currentDeadline, later),
    "2026-08-02T00:00:25.000Z",
  );
});
test("expired deadline is resolved by the server and advances the turn", () => {
  const state = createInitialOkeyGame(0);
  const next = resolveAuthoritativeDeadline(state, "2026-08-02T00:00:00.000Z", Date.parse("2026-08-02T00:01:00.000Z"));
  assert.notEqual(next, state);
  assert.notEqual(next.currentPlayerIndex, state.currentPlayerIndex);
});

test("an eliminated Human has no deadline and advances through one exact authoritative turn", () => {
  const match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const actor = match.roundState.players[0];
  const prepared = {
    ...match,
    roundState: {
      ...match.roundState,
      currentPlayerIndex: 0,
      hasDrawnThisTurn: false,
      deck: [
        { id: "eliminated-draw", color: "red" as const, value: 9, copy: 1 as const },
        ...match.roundState.deck,
      ],
      players: match.roundState.players.map((player, index) =>
        index === 0 ? { ...player, eliminated: true } : player
      ),
    },
  };

  assert.equal(getNextOkeyMatchTurnDeadline(prepared), null);

  const next = applyAuthoritativeOkeyEliminatedTurn(prepared, actor.id);
  assert.equal(next.roundState.discardPile.at(-1)?.id, "eliminated-draw");
  assert.notEqual(next.roundState.currentPlayerIndex, 0);
  assert.throws(
    () => applyAuthoritativeOkeyEliminatedTurn(next, actor.id),
    (error) => error instanceof OkeyCommandError && error.code === "command_rejected",
  );
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
    turnStartsAt: null,
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

  match = resolveAuthoritativeMatchDeadline(forcePlayerTurn(match, playerIndex), expiredDeadline, afterDeadline);
  match = forcePlayerTurn(match, playerIndex);
  const drawnTileId = match.roundState.deck[0].id;
  match = resolveAuthoritativeMatchDeadline(match, expiredDeadline, afterDeadline);

  assert.equal(match.timeoutCountsByPlayerId[playerId], 2);
  assert.equal(match.roundState.discardPile.at(-1)?.id, drawnTileId);
  assert.equal(isOkeyBotControlled(match.roundState.players[playerIndex]), true);
});

test("the second consecutive timeout immediately hands the timed-out seat to the bot worker", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = 1;
  match = forcePlayerTurn(match, playerIndex);
  const originalPlayer = match.roundState.players[playerIndex];

  match = resolveAuthoritativeMatchDeadline(match, expiredDeadline, afterDeadline);
  match = resolveAuthoritativeMatchDeadline(
    forcePlayerTurn(match, playerIndex),
    expiredDeadline,
    afterDeadline,
  );

  assert.equal(match.timeoutCountsByPlayerId[originalPlayer.id], 2);
  assert.equal(isOkeyBotControlled(match.roundState.players[playerIndex]), true);
  const controlledPlayer = match.roundState.players[playerIndex];

  assert.equal(match.timeoutCountsByPlayerId[originalPlayer.id], 2);
  assert.equal(isOkeyBotControlled(controlledPlayer), true);
  assert.equal(controlledPlayer.id, originalPlayer.id);
  assert.equal(controlledPlayer.teamId, originalPlayer.teamId);
  assert.equal(controlledPlayer.kind, "bot");
  assert.match(controlledPlayer.name, /^Bot [3-9]\d{2}$/);
  assert.notEqual(controlledPlayer.name, originalPlayer.name);
  assert.ok((controlledPlayer.botNumber ?? 0) >= 300);

  // The authoritative layer now transfers ownership only.
  // process_bot_turns is the single source of truth for executing the bot move.

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
test("a successful Human draw resets the consecutive Draw-timeout streak", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = match.roundState.currentPlayerIndex;
  const playerId = match.roundState.players[playerIndex].id;

  match = resolveAuthoritativeMatchDeadline(
    forcePlayerTurn(match, playerIndex),
    expiredDeadline,
    afterDeadline,
  );
  assert.equal(match.timeoutCountsByPlayerId[playerId], 1);

  const drawPhase = forcePlayerTurn(match, playerIndex);
  const afterHumanDraw = applyAuthoritativeOkeyMatchCommand(
    drawPhase,
    playerIndex,
    { type: "draw", source: "deck" },
  );

  assert.equal(afterHumanDraw.timeoutCountsByPlayerId[playerId], 0);
  assert.equal(afterHumanDraw.roundState.hasDrawnThisTurn, true);
});

test("Throw timeout only auto-discards and does not increment or trigger Draw-timeout takeover", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = match.roundState.currentPlayerIndex;
  const playerId = match.roundState.players[playerIndex].id;
  match = {
    ...match,
    timeoutCountsByPlayerId: { ...match.timeoutCountsByPlayerId, [playerId]: 1 },
    roundState: { ...match.roundState, hasDrawnThisTurn: true },
  };
  const handCountBefore = match.roundState.players[playerIndex].hand.length;

  const afterThrowTimeout = resolveAuthoritativeMatchDeadline(
    match,
    expiredDeadline,
    afterDeadline,
  );

  assert.equal(afterThrowTimeout.timeoutCountsByPlayerId[playerId], 1);
  assert.equal(isOkeyBotControlled(afterThrowTimeout.roundState.players[playerIndex]), false);
  assert.equal(afterThrowTimeout.roundState.players[playerIndex].hand.length, handCountBefore - 1);
  assert.notEqual(afterThrowTimeout.roundState.currentPlayerIndex, playerIndex);
});

test("Throw commands do not clear a Draw-timeout streak; only Human draw does", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = match.roundState.currentPlayerIndex;
  const playerId = match.roundState.players[playerIndex].id;
  match = {
    ...match,
    timeoutCountsByPlayerId: { ...match.timeoutCountsByPlayerId, [playerId]: 1 },
    roundState: { ...match.roundState, hasDrawnThisTurn: true },
  };
  const tileId = match.roundState.players[playerIndex].hand[0].id;

  const afterDiscard = applyAuthoritativeOkeyMatchCommand(
    match,
    playerIndex,
    { type: "discard", tileId },
  );

  assert.equal(afterDiscard.timeoutCountsByPlayerId[playerId], 1);
});
test("manual leave preserves the seat state and bot control across an exact next-round transition", () => {
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

  const settledRound = settleAuthoritativeOkeyRound({
    ...left,
    roundState: {
      ...left.roundState,
      phase: "finished",
      winnerId: left.roundState.players[0].id,
      endReason: "win",
    },
  });
  assert.equal(settledRound.currentRound, 1);
  assert.equal(settledRound.roundState.phase, "finished");
  assert.equal(getNextOkeyMatchTurnDeadline(settledRound), null);

  const nextRound = startAuthoritativeOkeyNextRound(settledRound);

  assert.equal(nextRound.matchFinished, false);
  assert.equal(nextRound.currentRound, 2);
  assert.equal(nextRound.roundState.phase, "playing");
  assert.equal(
    isOkeyBotControlled(nextRound.roundState.players[1]),
    true,
  );

  assert.equal(nextRound.roundState.players[1].name, controlledPlayer.name);
  assert.equal(nextRound.roundState.players[1].botNumber, controlledPlayer.botNumber);
  assert.equal(nextRound.roundState.players[1].kind, "bot");});

test("a committed round remains FINISHED until exactly one next-round transition", () => {
  const match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const finishedRound = {
    ...match.roundState,
    phase: "finished" as const,
    winnerId: match.roundState.players[2].id,
    endReason: "win" as const,
  };

  const settled = settleAuthoritativeOkeyRound({
    ...match,
    roundState: finishedRound,
  });

  assert.equal(settled.currentRound, 1);
  assert.equal(settled.roundResults.length, 1);
  assert.equal(settled.roundState, finishedRound);
  assert.equal(settled.roundState.phase, "finished");
  assert.equal(getNextOkeyMatchTurnDeadline(settled), null);

  const started = startAuthoritativeOkeyNextRound(settled);
  assert.equal(started.currentRound, 2);
  assert.equal(started.roundState.phase, "playing");
  assert.equal(started.roundState.dealerIndex, 2);
  assert.equal(started.roundResults.length, 1);
  assert.throws(
    () => startAuthoritativeOkeyNextRound(started),
    (error) => error instanceof OkeyCommandError && error.code === "command_rejected",
  );
});

test("tile-cycle completion also waits for a separate same-round restart", () => {
  const match = createAuthoritativeOkeyMatch(matchPlayers, 3);
  const settled = settleAuthoritativeOkeyRound({
    ...match,
    roundState: {
      ...match.roundState,
      phase: "finished",
      winnerId: null,
      endReason: "tile-cycle-limit",
    },
  });

  assert.equal(settled.currentRound, 1);
  assert.equal(settled.roundResults.length, 0);
  assert.equal(settled.roundState.phase, "finished");

  const restarted = startAuthoritativeOkeyNextRound(settled);
  assert.equal(restarted.currentRound, 1);
  assert.equal(restarted.roundState.phase, "playing");
  assert.equal(restarted.roundState.dealerIndex, 3);
});

test("a whole-team leave finishes the match immediately", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  match = applyAuthoritativeManualLeave(match, 1);
  match = applyAuthoritativeManualLeave(match, 3);

  assert.equal(match.pendingForfeitTeamId, "teamB");
  assert.equal(isOkeyBotControlled(match.roundState.players[1]), true);
  assert.equal(isOkeyBotControlled(match.roundState.players[3]), true);
  assert.equal(match.matchFinished, true);
  assert.equal(match.matchWinnerTeamId, "teamA");
  assert.equal(match.leaveTerminationReason, "team-forfeit");
  assert.equal(match.nextRoundEligibleAt, null);
  assert.equal(match.currentRound, 1);
  assert.equal(match.roundResults.length, 0);
  assert.equal(match.roundState.phase, "playing");
  assert.equal(getNextOkeyMatchTurnDeadline(match), null);
});

test("manual leave plus teammate timeout takeover creates a team forfeit", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  match = applyAuthoritativeManualLeave(match, 1);
  match = {
    ...forcePlayerTurn(match, 3),
    timeoutCountsByPlayerId: { ...match.timeoutCountsByPlayerId, "player-3": 1 },
  };

  match = resolveAuthoritativeMatchDeadline(match, expiredDeadline, afterDeadline);

  assert.deepEqual(match.manualLeftPlayerIds, ["player-1"]);
  assert.equal(match.pendingForfeitTeamId, "teamB");
  assert.equal(match.leaveTerminationReason, "team-forfeit");
});

test("two timeout takeovers on one team create a team forfeit", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  match = {
    ...match,
    roundState: handSeatToBot(match.roundState, 1, "normal"),
    timeoutCountsByPlayerId: { ...match.timeoutCountsByPlayerId, "player-1": 2, "player-3": 1 },
  };
  match = resolveAuthoritativeMatchDeadline(forcePlayerTurn(match, 3), expiredDeadline, afterDeadline);

  assert.equal(isOkeyBotControlled(match.roundState.players[1]), true);
  assert.deepEqual(match.manualLeftPlayerIds, []);
  assert.equal(match.pendingForfeitTeamId, "teamB");
  assert.equal(match.leaveTerminationReason, "team-forfeit");
});

test("a whole-team forfeit after round settlement terminates without creating a next round", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  match = settleAuthoritativeOkeyRound({
    ...match,
    roundState: {
      ...match.roundState,
      phase: "finished",
      winnerId: match.roundState.players[0].id,
      endReason: "win",
    },
  });

  assert.equal(match.matchFinished, false);
  assert.ok(match.nextRoundEligibleAt);

  match = applyAuthoritativeManualLeave(match, 1);
  match = applyAuthoritativeManualLeave(match, 3);

  assert.equal(match.matchFinished, true);
  assert.equal(match.matchWinnerTeamId, "teamA");
  assert.equal(match.nextRoundEligibleAt, null);
  assert.throws(
    () => startAuthoritativeOkeyNextRound(match),
    (error) => error instanceof OkeyCommandError && error.code === "command_rejected",
  );
});
test("a whole-team departure in round three terminates immediately without bot continuation", () => {
  let match = {
    ...createAuthoritativeOkeyMatch(matchPlayers, 0),
    currentRound: 3,
  };
  match = applyAuthoritativeManualLeave(match, 1);
  match = applyAuthoritativeManualLeave(match, 3);

  assert.equal(match.matchFinished, true);
  assert.equal(match.matchWinnerTeamId, "teamA");
  assert.equal(match.leaveTerminationReason, "team-forfeit");
  assert.deepEqual([...match.manualLeftPlayerIds].sort(), ["player-1", "player-3"]);
  assert.equal(match.currentRound, 3);
  assert.equal(match.roundResults.length, 0);
  assert.equal(getNextOkeyMatchTurnDeadline(match), null);
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

test("open-and-discard atomically opens melds and discards the requested remainder", () => {
  const initial = createInitialOkeyGame(0);
  const actorPlayerIndex = 0;
  const setTiles = [
    { id: "open-r10", color: "red", value: 10, copy: 1 },
    { id: "open-b10", color: "blue", value: 10, copy: 1 },
    { id: "open-k10", color: "black", value: 10, copy: 1 },
    { id: "open-r11", color: "red", value: 11, copy: 1 },
    { id: "open-b11", color: "blue", value: 11, copy: 1 },
    { id: "open-k11", color: "black", value: 11, copy: 1 },
    { id: "open-r12", color: "red", value: 12, copy: 1 },
    { id: "open-b12", color: "blue", value: 12, copy: 1 },
    { id: "open-k12", color: "black", value: 12, copy: 1 },
  ] as const;
  const remainder = { id: "open-remainder", color: "yellow", value: 1, copy: 1 } as const;
  const state = {
    ...initial,
    currentPlayerIndex: actorPlayerIndex,
    hasDrawnThisTurn: true,
    okeyTile: { id: "okey", color: "yellow", value: 13, copy: 1 } as const,
    players: initial.players.map((player, index) => index === actorPlayerIndex
      ? { ...player, hand: [...setTiles, remainder], opened: false, melds: [], scoreOpened: 0, firstOpenScore: null, konkan: false }
      : player),
  };
  const melds = [10, 11, 12].map((value) => ({
    id: `open-set-${value}`,
    ownerId: state.players[actorPlayerIndex].id,
    kind: "set" as const,
    tiles: state.players[actorPlayerIndex].hand.filter((tile) => tile.value === value),
    score: value * 3,
  }));

  const next = applyAuthoritativeOkeyCommand(state, actorPlayerIndex, {
    type: "open-and-discard",
    melds,
    score: 99_999,
    tileId: remainder.id,
  });

  assert.equal(next.players[actorPlayerIndex].opened, true);
  assert.equal(next.players[actorPlayerIndex].hand.some((tile) => tile.id === remainder.id), false);
  assert.equal(next.discardPile.at(-1)?.id, remainder.id);
  assert.notEqual(next, state);
});

test("open-and-discard rolls back the entire command when discard fails after a valid open", () => {
  const initial = createInitialOkeyGame(0);
  const actorPlayerIndex = 0;
  const setTiles = [
    { id: "rollback-r10", color: "red", value: 10, copy: 1 },
    { id: "rollback-b10", color: "blue", value: 10, copy: 1 },
    { id: "rollback-k10", color: "black", value: 10, copy: 1 },
    { id: "rollback-r11", color: "red", value: 11, copy: 1 },
    { id: "rollback-b11", color: "blue", value: 11, copy: 1 },
    { id: "rollback-k11", color: "black", value: 11, copy: 1 },
    { id: "rollback-r12", color: "red", value: 12, copy: 1 },
    { id: "rollback-b12", color: "blue", value: 12, copy: 1 },
    { id: "rollback-k12", color: "black", value: 12, copy: 1 },
  ] as const;
  const remainder = { id: "rollback-remainder", color: "yellow", value: 1, copy: 1 } as const;
  const state = {
    ...initial,
    currentPlayerIndex: actorPlayerIndex,
    hasDrawnThisTurn: true,
    okeyTile: { id: "okey-rollback", color: "yellow", value: 13, copy: 1 } as const,
    players: initial.players.map((player, index) => index === actorPlayerIndex
      ? { ...player, hand: [...setTiles, remainder], opened: false, melds: [], scoreOpened: 0, firstOpenScore: null, konkan: false }
      : player),
  };
  const melds = [10, 11, 12].map((value) => ({
    id: `rollback-set-${value}`,
    ownerId: state.players[actorPlayerIndex].id,
    kind: "set" as const,
    tiles: state.players[actorPlayerIndex].hand.filter((tile) => tile.value === value),
    score: value * 3,
  }));
  const tileConsumedByOpen = setTiles[0].id;

  assert.throws(
    () => applyAuthoritativeOkeyCommand(state, actorPlayerIndex, {
      type: "open-and-discard",
      melds,
      score: 99_999,
      tileId: tileConsumedByOpen,
    }),
    (error) => error instanceof OkeyCommandError && error.code === "command_rejected",
  );

  assert.equal(state.players[actorPlayerIndex].opened, false);
  assert.equal(state.players[actorPlayerIndex].melds.length, 0);
  assert.equal(state.players[actorPlayerIndex].hand.length, setTiles.length + 1);
  assert.notEqual(state.discardPile.at(-1)?.id, tileConsumedByOpen);
});

test("authoritative KonKan requires explicit rack declaration and ordinary discard cannot win", () => {
  const base = createInitialOkeyGame(0);
  const okeyTile = { id: "okey-ref", color: "blue" as const, value: 13, copy: 1 as const };
  const runTiles = Array.from({ length: 10 }, (_, index) => ({
    id: `run-${index + 1}`, color: "red" as const, value: index + 1, copy: 1 as const,
  }));
  const completionTiles = [2, 3, 4, 5].map((value) => ({
    id: `completion-${value}`, color: "yellow" as const, value, copy: 1 as const,
  }));
  const finalDiscard = { id: "final-discard", color: "black" as const, value: 12, copy: 1 as const };
  const hand = [...runTiles, ...completionTiles, finalDiscard];
  const actorIndex = base.currentPlayerIndex;
  const prepared = {
    ...base,
    okeyTile,
    players: base.players.map((player, index) => index === actorIndex
      ? { ...player, konkan: true, konkanEntryReason: "discard-pick" as const, hand }
      : player),
  };

  const discarded = applyAuthoritativeOkeyCommand(prepared, actorIndex, {
    type: "discard",
    tileId: finalDiscard.id,
  });
  assert.equal(discarded.phase, "playing");
  assert.equal(discarded.winnerId, null);

  const entering = {
    ...prepared,
    players: prepared.players.map((player, index) => index === actorIndex
      ? { ...player, konkan: false, konkanEntryReason: null, pendingKonkanFromDiscard: true }
      : player),
  };
  const enteredByDiscard = applyAuthoritativeOkeyCommand(entering, actorIndex, {
    type: "discard",
    tileId: finalDiscard.id,
  });
  assert.equal(enteredByDiscard.phase, "playing");
  assert.equal(enteredByDiscard.winnerId, null);
  assert.equal(enteredByDiscard.players[actorIndex].konkan, true);

  assert.throws(
    () => applyAuthoritativeOkeyCommand(prepared, actorIndex, {
      type: "declare-konkan",
      orderedRunTileIds: runTiles.map((tile) => tile.id),
    } as never),
    (error) => error instanceof OkeyCommandError && error.code === "command_rejected",
  );

  const declared = applyAuthoritativeOkeyCommand(prepared, actorIndex, {
    type: "declare-konkan",
    orderedRunTileIds: runTiles.map((tile) => tile.id),
    completionMeldTileIds: completionTiles.map((tile) => tile.id),
    discardTileId: finalDiscard.id,
  });
  assert.equal(declared.phase, "finished");
  assert.equal(declared.winnerId, prepared.players[actorIndex].id);
  assert.equal(declared.discardPile.at(-1)?.id, finalDiscard.id);
});

test("runtime parser preserves the complete authoritative KonKan declaration", () => {
  const edge = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
  assert.match(edge, /case "declare-konkan"[\s\S]*completionMeldTileIds: command\.completionMeldTileIds as string\[\][\s\S]*discardTileId: command\.discardTileId/);
});
