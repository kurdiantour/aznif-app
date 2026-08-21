import assert from "node:assert/strict";
import test from "node:test";

import { reduceOneVsOnePass } from "../authoritative/domino-one-vs-one-command-reducer.ts";

const players = [
  { user_id: "player-a", team_id: "teamA" as const },
  { user_id: "player-b", team_id: "teamB" as const },
];
const tile = (left: number, right: number) => ({ left, right });

test("ordinary pass advances the turn and opens draw phase when the yard can help", () => {
  const result = reduceOneVsOnePass({
    state: { board: { centerTile: tile(6, 6) }, teamScores: { teamA: 0, teamB: 0 } },
    hands: [[tile(1, 2)], [tile(3, 4)]],
    boneyard: [tile(5, 6)],
    players,
    playerIndex: 0,
    currentTurnPlayerId: "player-a",
    timedOut: false,
    phaseStartedAt: "now",
    isHandPlayable: () => false,
    isBoneyardPlayable: () => true,
  });

  assert.equal(result.nextTurnPlayerId, "player-b");
  assert.equal(result.nextState.canDrawTile, true);
  assert.equal(result.nextState.drawStartedAt, "now");
  assert.deepEqual(result.nextState.blockedPasses, ["player-a"]);
});

test("two blocked passes resolve the lower-pip hand and preserve blocker leadership", () => {
  const hands = [[tile(1, 2)], [tile(6, 6)]];
  const result = reduceOneVsOnePass({
    state: {
      board: { centerTile: tile(5, 5) },
      blockedPasses: ["player-b"],
      lastMovePlayerId: "player-b",
      teamScores: { teamA: 0, teamB: 0 },
    },
    hands,
    boneyard: [],
    players,
    playerIndex: 0,
    currentTurnPlayerId: "player-a",
    timedOut: false,
    phaseStartedAt: "now",
    isHandPlayable: () => false,
    isBoneyardPlayable: () => false,
  });

  assert.equal(result.nextState.roundWinnerPlayerId, "player-a");
  assert.equal(result.nextState.leaderPlayerId, "player-b");
  assert.equal(result.nextTurnPlayerId, "player-b");
  assert.equal(result.nextState.teamScores.teamA, 10);
  assert.equal(result.nextState.roundEndReason, "blocked");
  assert.equal(result.nextState.revealedFinalHands, hands);
});

test("opening timeout passes the turn and lets the next player open with any playable tile", () => {
  let observedRuleState: Record<string, any> | null = null;
  const result = reduceOneVsOnePass({
    state: {
      board: { centerTile: null },
      isOpeningRound: true,
      isFirstRound: true,
      openingDouble: 6,
      openingTileId: "6-6",
    },
    hands: [[], []],
    boneyard: [],
    players,
    playerIndex: 0,
    currentTurnPlayerId: "player-a",
    timedOut: true,
    phaseStartedAt: "now",
    isHandPlayable: (_playerIndex, ruleState) => {
      observedRuleState = ruleState;
      return true;
    },
    isBoneyardPlayable: () => false,
  });

  assert.equal(result.nextTurnPlayerId, "player-b");
  assert.equal(result.nextState.currentTurnPlayerId, "player-b");
  assert.equal(result.nextState.isOpeningRound, false);
  assert.equal(result.nextState.openingDouble, null);
  assert.equal(result.nextState.openingTileId, null);
  const observed = observedRuleState as Record<string, any> | null;
  assert.equal(observed?.isOpeningRound, false);
  assert.equal(observed?.openingDouble, null);
});
