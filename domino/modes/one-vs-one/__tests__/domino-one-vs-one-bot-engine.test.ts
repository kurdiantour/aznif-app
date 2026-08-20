import assert from "node:assert/strict";
import test from "node:test";

import { reduceDominoOneVsOneBotTurn } from "../bot/domino-one-vs-one-bot-engine.ts";

const players = [
  { user_id: "p1", team_id: "teamA" },
  { user_id: "p2", team_id: "teamB" },
];
const rules: any = {
  createEmptyBoard: () => ({ centerTile: null }),
  getPlayableBranches: (tile: any) => tile.playable ? ["left"] : [],
  applyMove: (board: any, tile: any) => ({ board: { ...board, centerTile: tile }, spinnerValue: null, moveScore: 5 }),
  canHandMove: (hand: any[]) => hand.some((tile) => tile.playable),
  resolveMatchOutcome: () => ({ winningTeamId: null, matchReward: null }),
};

test("bot picks the first playable tile and preserves scoring", () => {
  const tile = { id: "1-2", left: 1, right: 2, playable: true };
  const result = reduceDominoOneVsOneBotTurn({
    state: { teamScores: { teamA: 0, teamB: 0 } },
    hands: [[tile, { id: "3-4", left: 3, right: 4 }], []], boneyard: [],
    players, playerIndex: 0, currentTurnPlayerId: "p1", rules,
  });
  assert.equal(result.action, "bot_play_tile");
  assert.equal(result.nextHands[0].length, 1);
  assert.equal(result.nextState.teamScores.teamA, 5);
  assert.equal(result.nextState.currentTurnPlayerId, "p2");
});

test("bot draws and auto-passes only on the production third-draw limit", () => {
  const result = reduceDominoOneVsOneBotTurn({
    state: { board: { centerTile: { id: "6-6" } }, currentTurnDrawCount: 2 },
    hands: [[{ id: "1-1", left: 1, right: 1 }], []],
    boneyard: [{ id: "2-2", left: 2, right: 2 }], players,
    playerIndex: 0, currentTurnPlayerId: "p1", rules,
  });
  assert.equal(result.action, "bot_draw_tile_auto_pass");
  assert.equal(result.nextState.currentTurnDrawCount, 0);
  assert.equal(result.nextState.currentTurnPlayerId, "p2");
});

test("two blocked passes resolve the lower-pip hand and keep blocker leader", () => {
  const result = reduceDominoOneVsOneBotTurn({
    state: { board: { centerTile: {} }, blockedPasses: ["p2"], lastMovePlayerId: "p2" },
    hands: [[{ id: "1-1", left: 1, right: 1 }], [{ id: "6-6", left: 6, right: 6 }]],
    boneyard: [], players, playerIndex: 0, currentTurnPlayerId: "p1", rules,
  });
  assert.equal(result.action, "bot_pass_turn");
  assert.equal(result.nextState.roundWinnerPlayerId, "p1");
  assert.equal(result.nextState.leaderPlayerId, "p2");
});
