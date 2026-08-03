import assert from "node:assert/strict";
import test from "node:test";

import { createInitialOkeyGame, getMatchWinnerTeamId, getNextRoundDealerIndex } from "../okey-engine.ts";

test("the previous round winner becomes dealer from every seat", () => {
  const state = createInitialOkeyGame(0);
  for (let winnerIndex = 0; winnerIndex < state.players.length; winnerIndex += 1) {
    assert.equal(getNextRoundDealerIndex({ ...state, winnerId: state.players[winnerIndex].id }), winnerIndex);
  }
});

test("lower match score wins and equal totals produce a draw", () => {
  assert.equal(getMatchWinnerTeamId({ teamA: 40, teamB: 80 }), "teamA");
  assert.equal(getMatchWinnerTeamId({ teamA: 90, teamB: 20 }), "teamB");
  assert.equal(getMatchWinnerTeamId({ teamA: 50, teamB: 50 }), null);
});
