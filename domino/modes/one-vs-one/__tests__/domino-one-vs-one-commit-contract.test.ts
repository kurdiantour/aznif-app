import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOneVsOneDrawCommit,
  buildOneVsOneMoveCommit,
  buildOneVsOnePassCommit,
} from "../server/domino-one-vs-one-commit-contract.ts";

const common = {
  roomId: "room-1", expectedVersion: 7, state: { turn: 2 },
  hands: [[{ id: "1-2" }], []], boneyard: [{ id: "3-4" }],
  currentTurnPlayerId: "player-2", status: "active", playerId: "player-1",
};

test("move commit preserves the authoritative RPC contract", () => {
  const tile = { id: "1-2" };
  assert.deepEqual(buildOneVsOneMoveCommit({
    ...common, tile, branch: "left", moveScore: 5, wasOpeningMove: true,
  }), {
    p_mode: "1v1", p_room_id: "room-1", p_expected_version: 7,
    p_state: common.state, p_hands: common.hands, p_boneyard: common.boneyard,
    p_current_turn_player_id: "player-2", p_status: "active", p_player_id: "player-1",
    p_action: "play_tile",
    p_payload: { tile, branch: "left", moveScore: 5, wasOpeningMove: true },
  });
});

test("draw commit preserves automatic-draw metadata", () => {
  const value = buildOneVsOneDrawCommit({
    ...common, status: null, action: "auto_draw_tile_auto_pass",
    currentTurnDrawCount: 3, timedOut: true, autoPassed: true,
    triggeredByUserId: "watcher",
  });
  assert.equal(value.p_status, null);
  assert.equal(value.p_action, "auto_draw_tile_auto_pass");
  assert.deepEqual(value.p_payload, {
    remainingBoneyard: 1, currentTurnDrawCount: 3,
    autoDrawn: true, autoPassed: true, triggeredByUserId: "watcher",
  });
});

test("pass commit keeps the acting player separate from next player", () => {
  const value = buildOneVsOnePassCommit({
    ...common, timedOut: false, blockedRoundResolved: true,
  });
  assert.equal(value.p_player_id, "player-1");
  assert.equal(value.p_current_turn_player_id, "player-2");
  assert.deepEqual(value.p_payload, {
    nextPlayerId: "player-2", timedOut: false, blockedRoundResolved: true,
  });
});
