import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  executeAuthoritativeOkeyTurn,
  type OkeyTurnController,
} from "../../../lib/multiplayer/okey/okey-turn-engine.ts";

for (const controller of ["human", "bot", "timeout", "disconnect", "reconnect", "manual-leave", "elimination", "next-round"] as const satisfies readonly OkeyTurnController[]) {
  test(`${controller} uses Validate -> Commit -> Advance -> Broadcast`, async () => {
    const stages: string[] = [];
    const result = await executeAuthoritativeOkeyTurn({
      controller,
      matchId: "match-1",
      actorPlayerId: "player-1",
      commandId: "command-1",
      commandType: "test",
      expectedVersion: 3,
      intent: { kind: controller },
      validate: () => {
        stages.push("validate");
        return {
          state: { turn: 2 },
          projection: { turn: 2 },
          deadline: "2026-09-04T12:00:00.000Z",
          status: "playing",
          actionEvents: [{ type: controller }],
        };
      },
      commit: async (prepared) => {
        stages.push("commit");
        return {
          applied: true,
          version: 4,
          state: prepared.state,
          turn_deadline_at: prepared.deadline,
          action_events: prepared.actionEvents,
        };
      },
      advance: async (committed) => {
        stages.push("advance");
        return committed;
      },
      broadcast: async ({ version }) => {
        stages.push("broadcast");
        assert.equal(version, 4);
      },
    });

    assert.deepEqual(stages, ["validate", "commit", "advance", "broadcast"]);
    assert.equal(result.controller, controller);
    assert.equal(result.committed.version, 4);
  });
}

test("an uncommitted turn never advances or broadcasts", async () => {
  const effects: string[] = [];
  const result = await executeAuthoritativeOkeyTurn({
    controller: "human",
    matchId: "match-1",
    actorPlayerId: "player-1",
    commandId: "command-1",
    commandType: "draw",
    expectedVersion: 1,
    intent: null,
    validate: () => ({
      state: {},
      projection: {},
      deadline: null,
      status: "playing",
      actionEvents: [],
    }),
    commit: async () => ({
      applied: false,
      version: 1,
      state: {},
      turn_deadline_at: null,
      action_events: [],
    }),
    advance: async (committed) => {
      effects.push("advance");
      return committed;
    },
    broadcast: async () => {
      effects.push("broadcast");
    },
  });
  assert.equal(result.committed.applied, false);
  assert.deepEqual(effects, []);
});

test("Okey lifecycle entry points share the existing turn engine", () => {
  const match = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
  const room = readFileSync("supabase/functions/okey_room/index.ts", "utf8");
  const reconciler = readFileSync("okey/server/okey-server-reconciler.ts", "utf8");

  assert.match(match, /controller: action === "manual-leave" \? "manual-leave" : "human"/);
  assert.match(room, /controller: action === "reconnect" \? "reconnect" : "disconnect"/);
  assert.match(reconciler, /controller: "elimination"/);
  assert.match(reconciler, /controller: "timeout"/);
  assert.match(reconciler, /controller: "next-round"/);
  assert.doesNotMatch(room, /from ["'].*domino/);
});