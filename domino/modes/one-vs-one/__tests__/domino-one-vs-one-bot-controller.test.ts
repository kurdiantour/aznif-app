import assert from "node:assert/strict";
import test from "node:test";

import { processDominoOneVsOneBotTurn } from "../bot/domino-one-vs-one-bot-controller.ts";

function setupClient(commitError: any = null) {
  const calls: any[] = [];
  return {
    calls,
    client: {
      rpc: async (name: string, payload: any) => {
        calls.push({ name, payload });
        if (name === "commit_multiplayer_action") return { data: { version: Number(payload.p_expected_version) + 1 }, error: commitError };
        return { data: { forfeit: false }, error: null };
      },
      from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
    },
  };
}

const rules: any = {
  createEmptyBoard: () => ({ centerTile: null }),
  getPlayableBranches: () => [],
  applyMove: () => { throw new Error("not used"); },
  canHandMove: () => false,
  resolveMatchOutcome: () => ({ winningTeamId: null, matchReward: null }),
};

test("controller commits exactly one 1v1 bot transition", async () => {
  const { client, calls } = setupClient();
  const result = await processDominoOneVsOneBotTurn({
    client, room: { id: "r", version: 1 }, state: { board: { centerTile: {} } },
    hands: [[], []], boneyard: [],
    players: [{ user_id: "p1", team_id: "teamA" }, { user_id: "p2", team_id: "teamB" }],
    playerIndex: 0, currentTurnPlayerId: "p1", rules,
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "commit_multiplayer_action");
  assert.equal(calls[0].payload.p_mode, "1v1");
  assert.equal(calls[0].payload.p_action, "bot_pass_turn");
});

test("controller maps an atomic version conflict to stale", async () => {
  const { client } = setupClient(new Error("STALE_GAME_STATE"));
  const result = await processDominoOneVsOneBotTurn({
    client, room: { id: "r", version: 1 }, state: { board: { centerTile: {} } },
    hands: [[], []], boneyard: [],
    players: [{ user_id: "p1", team_id: "teamA" }, { user_id: "p2", team_id: "teamB" }],
    playerIndex: 0, currentTurnPlayerId: "p1", rules,
  });
  assert.deepEqual(result, { ok: false, reason: "stale" });
});

test("takeover bot draws once, plays the newly playable tile, and returns the turn", async () => {
  const { client, calls } = setupClient();
  const playable = { id: "drawn", playable: true };
  const transitionRules: any = {
    createEmptyBoard: () => ({ centerTile: { id: "center" } }),
    getPlayableBranches: (tile: any) => tile.playable ? ["right"] : [],
    applyMove: (board: any) => ({ board, spinnerValue: null, moveScore: 0 }),
    canHandMove: (hand: any[]) => hand.some((tile) => tile.playable),
    resolveMatchOutcome: () => ({ winningTeamId: null, matchReward: null }),
  };

  const result = await processDominoOneVsOneBotTurn({
    client,
    room: { id: "r", version: 7 },
    state: {
      board: { centerTile: { id: "center" } },
      currentTurnPlayerId: "p1",
      currentTurnDrawCount: 0,
      teamScores: { teamA: 0, teamB: 0 },
    },
    hands: [[{ id: "blocked", playable: false }], [{ id: "human" }]],
    boneyard: [playable],
    players: [{ user_id: "p1", team_id: "teamA" }, { user_id: "p2", team_id: "teamB" }],
    playerIndex: 0,
    currentTurnPlayerId: "p1",
    rules: transitionRules,
  });

  const commits = calls.filter((call) => call.name === "commit_multiplayer_action");
  assert.equal(result.ok, true);
  assert.deepEqual(commits.map((call) => call.payload.p_action), ["bot_draw_tile", "bot_play_tile"]);
  assert.deepEqual(commits.map((call) => call.payload.p_expected_version), [7, 8]);
  assert.equal(result.ok && result.state.currentTurnPlayerId, "p2");
});

test("takeover bot makes at most three draws then atomically passes to the human", async () => {
  const { client, calls } = setupClient();
  const transitionRules: any = {
    ...rules,
    createEmptyBoard: () => ({ centerTile: { id: "center" } }),
  };

  const result = await processDominoOneVsOneBotTurn({
    client,
    room: { id: "r", version: 10 },
    state: {
      board: { centerTile: { id: "center" } },
      currentTurnPlayerId: "p1",
      currentTurnDrawCount: 0,
    },
    hands: [[{ id: "blocked" }], [{ id: "human" }]],
    boneyard: [{ id: "d1" }, { id: "d2" }, { id: "d3" }, { id: "untouched" }],
    players: [{ user_id: "p1", team_id: "teamA" }, { user_id: "p2", team_id: "teamB" }],
    playerIndex: 0,
    currentTurnPlayerId: "p1",
    rules: transitionRules,
  });

  const commits = calls.filter((call) => call.name === "commit_multiplayer_action");
  assert.equal(result.ok, true);
  assert.deepEqual(
    commits.map((call) => call.payload.p_action),
    ["bot_draw_tile", "bot_draw_tile", "bot_draw_tile_auto_pass"],
  );
  assert.deepEqual(commits.map((call) => call.payload.p_expected_version), [10, 11, 12]);
  assert.equal(commits.at(-1).payload.p_boneyard.length, 1);
  assert.equal(result.ok && result.state.currentTurnPlayerId, "p2");
  assert.equal(result.ok && result.state.currentTurnDrawCount, 0);
});