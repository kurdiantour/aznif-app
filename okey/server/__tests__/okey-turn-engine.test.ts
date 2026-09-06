import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  executeAuthoritativeOkeyLifecycleDecision,
  executeAuthoritativeOkeyTransition,
  executeAuthoritativeOkeyTurn,
  reduceAuthoritativeOkeyTransition,
  type OkeyAuthoritativeSnapshotBundle,
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



test("Human runtime enters reduction and commit through one engine transition entry", async () => {
  const stages: string[] = [];
  const result = await executeAuthoritativeOkeyTransition({
    state: 10,
    transition: { type: "human-command", actorPlayerIndex: 2, command: "draw" },
    reducers: {
      applyHumanCommand: (state, actorPlayerIndex, command, now) => {
        stages.push(`reduce:${actorPlayerIndex}:${command}:${now}`);
        return state + 1;
      },
      applyManualLeave: (state) => state,
      applyTimeout: (state) => state,
      applyEliminatedTurn: (state) => state,
      startNextRound: (state) => state,
      applyBotRoundState: (state) => state,
    },
    transitionNow: 123,
    controller: "human",
    matchId: "match-1",
    actorPlayerId: "player-1",
    commandId: "command-1",
    commandType: "draw",
    expectedVersion: 3,
    prepare: (nextState) => {
      stages.push(`prepare:${nextState}`);
      return {
        state: nextState,
        projection: { value: nextState },
        deadline: "2026-09-06T00:00:15.000Z",
        status: "playing",
        actionEvents: [{ type: "draw" }],
      };
    },
    commit: async (prepared) => {
      stages.push(`commit:${prepared.state}`);
      return {
        applied: true,
        version: 4,
        state: prepared.state,
        turn_deadline_at: prepared.deadline,
        action_events: prepared.actionEvents,
      };
    },
    broadcast: async () => {
      stages.push("broadcast");
    },
  });

  assert.deepEqual(stages, ["reduce:2:draw:123", "prepare:11", "commit:11", "broadcast"]);
  assert.equal(result.committed.state, 11);
});

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

test("lifecycle decision has one owner in okey-turn-engine", () => {
  const engine = readFileSync("lib/multiplayer/okey/okey-turn-engine.ts", "utf8");
  const authoritative = readFileSync("okey/server/okey-authoritative.ts", "utf8");
  const reconciler = readFileSync("okey/server/okey-server-reconciler.ts", "utf8");

  assert.match(engine, /export function evaluateOkeyServerLifecycle/);
  assert.doesNotMatch(authoritative, /export function evaluateOkeyServerLifecycle/);
  assert.doesNotMatch(authoritative, /export type OkeyLifecycleDecision/);
  assert.match(reconciler, /from ["']\.\.\/\.\.\/lib\/multiplayer\/okey\/okey-turn-engine\.ts["']/);
});



test("authoritative transition reduction has one engine gateway", () => {
  const calls: string[] = [];
  const reducers = {
    applyHumanCommand: (state: number, actorPlayerIndex: number, command: string, now: number) => {
      calls.push(`human:${actorPlayerIndex}:${command}:${now}`);
      return state + 1;
    },
    applyManualLeave: (state: number, actorPlayerIndex: number) => {
      calls.push(`leave:${actorPlayerIndex}`);
      return state + 2;
    },
    applyTimeout: (state: number, deadlineAt: string | null, now: number) => {
      calls.push(`timeout:${deadlineAt}:${now}`);
      return state + 3;
    },
    applyEliminatedTurn: (state: number, expectedActorId: string) => {
      calls.push(`ghost:${expectedActorId}`);
      return state + 4;
    },
    startNextRound: (state: number, now: number) => {
      calls.push(`next-round:${now}`);
      return state + 5;
    },
    applyBotRoundState: (state: number, roundState: string, now: number) => {
      calls.push(`bot:${roundState}:${now}`);
      return state + 6;
    },
  };

  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "human-command", actorPlayerIndex: 2, command: "draw" },
    reducers,
    now: 100,
  }), 1);
  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "manual-leave", actorPlayerIndex: 1 },
    reducers,
    now: 100,
  }), 2);
  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "timeout", deadlineAt: "deadline" },
    reducers,
    now: 100,
  }), 3);
  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "eliminated-turn", expectedActorId: "ghost-1" },
    reducers,
    now: 100,
  }), 4);
  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "next-round" },
    reducers,
    now: 100,
  }), 5);
  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "bot-action", roundState: "round-2" },
    reducers,
    now: 100,
  }), 6);

  assert.deepEqual(calls, [
    "human:2:draw:100",
    "leave:1",
    "timeout:deadline:100",
    "ghost:ghost-1",
    "next-round:100",
    "bot:round-2:100",
  ]);
});

test("runtime controllers no longer compose authoritative next state directly", () => {
  const match = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
  const reconciler = readFileSync("okey/server/okey-server-reconciler.ts", "utf8");
  const bot = readFileSync("okey/server/okey-bot-executor.ts", "utf8");

  assert.match(match, /executeAuthoritativeOkeyTransition/);
  assert.doesNotMatch(match, /executeAuthoritativeOkeyTurn/);
  assert.doesNotMatch(match, /reduceAuthoritativeOkeyTransition/);
  assert.doesNotMatch(match, /applyAuthoritativeOkeyMatchCommand\(/);
  assert.doesNotMatch(match, /applyAuthoritativeManualLeave\(/);

  assert.match(reconciler, /reduceAuthoritativeOkeyTransition/);
  assert.doesNotMatch(reconciler, /applyAuthoritativeOkeyEliminatedTurn\(/);
  assert.doesNotMatch(reconciler, /resolveAuthoritativeMatchDeadline\(/);
  assert.doesNotMatch(reconciler, /startAuthoritativeOkeyNextRound\(/);

  assert.match(bot, /type: "bot-action"/);
  assert.doesNotMatch(bot, /settleAuthoritativeOkeyRound\(\{\s*\.\.\.currentState/);
});


test("lifecycle controller dispatch has one engine owner", async () => {
  const called: string[] = [];
  const bundle = {
    state: { marker: 1 },
    version: 7,
    turn_deadline_at: null,
  } as unknown as OkeyAuthoritativeSnapshotBundle;
  const handlers = {
    eliminatedTurn: async () => { called.push("ghost"); return bundle; },
    botTurn: async () => { called.push("bot"); return bundle; },
    expiredHumanTurn: async () => { called.push("timeout"); return bundle; },
    dueNextRound: async () => { called.push("next-round"); return bundle; },
  };

  await executeAuthoritativeOkeyLifecycleDecision(
    { type: "eliminated-turn", expectedVersion: 7, expectedActorId: "g", playerIndex: 0 },
    bundle,
    handlers,
  );
  await executeAuthoritativeOkeyLifecycleDecision(
    {
      type: "bot-turn",
      expectedVersion: 7,
      expectedActorId: "b",
      playerIndex: 1,
      step: "draw",
      notBefore: null,
      ready: true,
    },
    bundle,
    handlers,
  );
  await executeAuthoritativeOkeyLifecycleDecision(
    {
      type: "expired-human-turn",
      expectedVersion: 7,
      expectedTurnPlayerId: "h",
      expectedTurnDeadlineAt: "2026-09-06T00:00:00.000Z",
    },
    bundle,
    handlers,
  );
  await executeAuthoritativeOkeyLifecycleDecision(
    { type: "due-next-round", expectedVersion: 7, expectedRound: 1, eligibleAt: "2026-09-06T00:00:00.000Z" },
    bundle,
    handlers,
  );

  assert.deepEqual(called, ["ghost", "bot", "timeout", "next-round"]);

  const engine = readFileSync("lib/multiplayer/okey/okey-turn-engine.ts", "utf8");
  const reconciler = readFileSync("okey/server/okey-server-reconciler.ts", "utf8");
  assert.match(engine, /export async function executeAuthoritativeOkeyLifecycleDecision/);
  assert.match(reconciler, /executeAuthoritativeOkeyLifecycleDecision\(decision, currentBundle/);
  assert.doesNotMatch(reconciler, /if \(decision\.type === "eliminated-turn"\)/);
  assert.doesNotMatch(reconciler, /if \(decision\.type === "bot-turn"\)/);
  assert.doesNotMatch(reconciler, /if \(decision\.type === "expired-human-turn"\)/);
  assert.doesNotMatch(reconciler, /if \(decision\.type === "due-next-round"\)/);
});

