import assert from "node:assert/strict";
import test from "node:test";

import { createInitialOkeyGame, getRequiredOpenScore } from "../okey-engine.ts";
import { OKEY_RULESET_V1 } from "../../rules/okey-ruleset-v1.ts";

test("ruleset v1 is the implemented four-player team baseline", () => {
  assert.equal(OKEY_RULESET_V1.version, 1);
  assert.equal(OKEY_RULESET_V1.status, "implemented-baseline");
  assert.equal(OKEY_RULESET_V1.opening.pairMode, false);
  assert.deepEqual(OKEY_RULESET_V1.table.counterClockwiseTurnOrder, [0, 3, 1, 2]);
  assert.equal(OKEY_RULESET_V1.match.roundCount, 7);
  assert.equal(OKEY_RULESET_V1.scoring.lowerMatchScoreWins, true);
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
