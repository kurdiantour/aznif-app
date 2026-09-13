import assert from "node:assert/strict";
import test from "node:test";

import { commitAuthoritativeOkeyAction } from "../okey-authoritative-commit-gateway.ts";
import {
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
  projectOkeyMatchPublicState,
} from "../okey-authoritative.ts";

const state = createAuthoritativeOkeyMatch([
  { id: "player-1", name: "Player 1" },
  { id: "player-2", name: "Player 2" },
  { id: "player-3", name: "Player 3" },
  { id: "player-4", name: "Player 4" },
], 0);
const deadline = getNextOkeyMatchTurnDeadline(state, Date.parse("2026-09-13T11:59:45.000Z"));
const prepared = {
  state,
  projection: projectOkeyMatchPublicState(state, 8, deadline),
  deadline,
  status: "playing" as const,
  actionEvents: [{ type: "draw", actorPlayerId: "player-1", payload: { source: "deck" } }],
} as any;

test("shared gateway commits and broadcasts the persisted authoritative result", async () => {
  let rpcName = "";
  let rpcParameters: Record<string, unknown> = {};
  let broadcastPayload: any = null;
  const committedState = { ...prepared.state, currentRound: 2 };
  const client = {
    rpc(name: string, parameters: Record<string, unknown>) {
      rpcName = name;
      rpcParameters = parameters;
      return {
        single: async () => ({
          data: {
            applied: true,
            version: 8,
            state: committedState,
            turn_deadline_at: prepared.deadline,
            action_events: [{ version: 8, sequence: 0, ...prepared.actionEvents[0] }],
          },
          error: null,
        }),
      };
    },
  };

  const result = await commitAuthoritativeOkeyAction({
    client,
    matchId: "match-1",
    actorPlayerId: "player-1",
    commandId: "command-1",
    expectedVersion: 7,
    commandType: "draw",
    prepared,
    commitFailureCode: "commit_failed",
    broadcast: async (payload) => {
      broadcastPayload = payload;
    },
  });

  assert.equal(rpcName, "okey_commit_authoritative_action");
  assert.equal(rpcParameters.p_expected_version, 7);
  assert.equal(rpcParameters.p_turn_deadline_at, prepared.deadline);
  assert.deepEqual(rpcParameters.p_action_events, prepared.actionEvents);
  assert.equal(result.state, committedState);
  assert.equal(broadcastPayload.version, 8);
  assert.equal(broadcastPayload.publicProjection.version, 8);
});

test("shared gateway preserves Human gameplay events through the atomic wrapper", async () => {
  let rpcName = "";
  let rpcParameters: Record<string, unknown> = {};
  const client = {
    rpc(name: string, parameters: Record<string, unknown>) {
      rpcName = name;
      rpcParameters = parameters;
      return {
        single: async () => ({
          data: {
            applied: true,
            version: 8,
            state: prepared.state,
            turn_deadline_at: prepared.deadline,
            action_events: [],
          },
          error: null,
        }),
      };
    },
  };
  const gameplayEvents = [{ event_type: "okey_draw" }];

  await commitAuthoritativeOkeyAction({
    client,
    matchId: "match-1",
    actorPlayerId: "player-1",
    commandId: "command-1",
    expectedVersion: 7,
    commandType: "draw",
    prepared,
    gameplayEvents,
    commitFailureCode: "commit_failed",
  });

  assert.equal(rpcName, "okey_commit_authoritative_action_with_events");
  assert.equal(rpcParameters.p_gameplay_events, gameplayEvents);
});

test("shared gateway converts a configured version conflict into a non-broadcast no-op", async () => {
  let broadcastCount = 0;
  const staleResult = {
    applied: false,
    version: 7,
    state: prepared.state,
    turn_deadline_at: prepared.deadline,
    action_events: [],
    rejectionReason: "stale_bot_controller",
  };
  const client = {
    rpc() {
      return {
        single: async () => ({ data: null, error: { message: "version_conflict" } }),
      };
    },
  };

  const result = await commitAuthoritativeOkeyAction({
    client,
    matchId: "match-1",
    actorPlayerId: "bot-1",
    commandId: "command-1",
    expectedVersion: 7,
    commandType: "system-bot-draw",
    prepared,
    versionConflictResult: staleResult,
    commitFailureCode: "commit_failed",
    broadcast: async () => {
      broadcastCount += 1;
    },
  });

  assert.equal(result, staleResult);
  assert.equal(broadcastCount, 0);
});
