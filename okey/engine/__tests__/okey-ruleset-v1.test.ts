import assert from "node:assert/strict";
import test from "node:test";

import { createInitialOkeyGame, getRequiredOpenScore } from "../okey-engine.ts";
import { resolveTimeoutTurn } from "../okey-timeout.ts";
import { OKEY_RULESET_V1 } from "../../rules/okey-ruleset-v1.ts";

test("ruleset v1 is the implemented four-player team baseline", () => {
  assert.equal(OKEY_RULESET_V1.version, 1);
  assert.equal(OKEY_RULESET_V1.status, "implemented-baseline");
  assert.equal(OKEY_RULESET_V1.opening.pairMode, false);
  assert.deepEqual(OKEY_RULESET_V1.table.seatTeamIds, ["teamA", "teamB", "teamA", "teamB"]);
  assert.deepEqual(OKEY_RULESET_V1.table.counterClockwiseTurnOrder, [0, 1, 2, 3]);
  assert.equal(OKEY_RULESET_V1.match.roundCount, 7);
  assert.equal(OKEY_RULESET_V1.scoring.lowerMatchScoreWins, true);
});

test("turns move bottom to right to top to left", () => {
  let state = createInitialOkeyGame(0);
  const observedTurnOrder = [state.currentPlayerIndex];

  for (let turn = 0; turn < OKEY_RULESET_V1.table.playerCount; turn += 1) {
    state = resolveTimeoutTurn(state, state.currentPlayerIndex);
    observedTurnOrder.push(state.currentPlayerIndex);
  }

  assert.deepEqual(observedTurnOrder, [0, 1, 2, 3, 0]);
});
test("initial state and opening thresholds stay aligned with ruleset v1", () => {
  const state = createInitialOkeyGame(0);
  const tileCount = state.players.reduce((total, player) => total + player.hand.length, 0)
    + state.deck.length
    + state.discardPile.length
    + 1;

  assert.equal(tileCount, 106);
  assert.equal(state.players[0].hand.length, OKEY_RULESET_V1.hand.dealerInitialSize);
  assert.equal(state.players[1].hand.length, OKEY_RULESET_V1.hand.playerInitialSize);
  assert.equal(getRequiredOpenScore(state, 0), OKEY_RULESET_V1.opening.initialMinimumScore);

  const opponentOpenedState = {
    ...state,
    teamFirstOpenScores: { teamA: null, teamB: 92 },
  };
  assert.equal(
    getRequiredOpenScore(opponentOpenedState, 0),
    92 + OKEY_RULESET_V1.opening.opponentFirstOpenIncrement,
  );
});
