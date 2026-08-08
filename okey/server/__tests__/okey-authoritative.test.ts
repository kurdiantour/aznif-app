import assert from "node:assert/strict";
import test from "node:test";

import { createInitialOkeyGame } from "../../engine/okey-engine.ts";
import {
  applyAuthoritativeOkeyCommand,
  applyAuthoritativeOkeyMatchCommand,
  applyAuthoritativeManualLeave,
  createAuthoritativeOkeyMatch,
  OkeyCommandError,
  projectOkeyPublicState,
  projectOkeyState,
  resolveAuthoritativeDeadline,
  resolveAuthoritativeMatchDeadline,
  settleAuthoritativeOkeyRound,
} from "../okey-authoritative.ts";
import { isOkeyBotControlled } from "../../engine/okey-bot-policy.ts";

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

test("authoritative timeout counts are cumulative and isolated per player", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);

  match = resolveAuthoritativeMatchDeadline(
    match,
    expiredDeadline,
    afterDeadline,
  );

  match = resolveAuthoritativeMatchDeadline(
    forcePlayerTurn(match, 1),
    expiredDeadline,
    afterDeadline,
  );

  assert.equal(match.timeoutCountsByPlayerId["player-0"], 1);
  assert.equal(match.timeoutCountsByPlayerId["player-1"], 1);
  assert.equal(match.timeoutCountsByPlayerId["player-2"], 0);
});

test("third cumulative timeout hands the same seat to a bot and immediately continues", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const originalPlayer = match.roundState.players[0];

  for (let timeout = 1; timeout <= 3; timeout += 1) {
    match = resolveAuthoritativeMatchDeadline(
      timeout === 1 ? match : forcePlayerTurn(match, 0),
      expiredDeadline,
      afterDeadline,
    );

    assert.equal(match.timeoutCountsByPlayerId[originalPlayer.id], timeout);
  }

  const controlledPlayer = match.roundState.players[0];
  assert.equal(isOkeyBotControlled(controlledPlayer), true);
  assert.equal(controlledPlayer.id, originalPlayer.id);
  assert.equal(controlledPlayer.teamId, originalPlayer.teamId);
  assert.equal(controlledPlayer.kind, "human");
  assert.notEqual(match.roundState.currentPlayerIndex, 0);
});

test("a valid human move resets consecutive timeout counts", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  match = resolveAuthoritativeMatchDeadline(
    match,
    expiredDeadline,
    afterDeadline,
  );

  match = resolveAuthoritativeMatchDeadline(
    forcePlayerTurn(match, 0),
    expiredDeadline,
    afterDeadline,
  );

  assert.equal(match.timeoutCountsByPlayerId["player-0"], 2);

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
});

test("the second manual leave on one team forfeits after the current round", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  match = applyAuthoritativeManualLeave(match, 2);
  match = applyAuthoritativeManualLeave(match, 3);

  assert.equal(match.pendingForfeitTeamId, "teamB");
  assert.equal(isOkeyBotControlled(match.roundState.players[2]), true);
  assert.equal(isOkeyBotControlled(match.roundState.players[3]), true);
  assert.equal(match.matchFinished, false);

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
});
