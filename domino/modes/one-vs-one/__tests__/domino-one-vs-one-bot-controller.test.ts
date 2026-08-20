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
        if (name === "commit_multiplayer_action") return { data: { version: 2 }, error: commitError };
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
