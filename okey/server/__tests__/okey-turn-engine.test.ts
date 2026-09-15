import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  reduceAuthoritativeOkeyTransition,
  type OkeyAuthoritativeSnapshotBundle,
} from "../okey-turn-engine.ts";

test("Okey lifecycle entry points use their current authoritative owners", () => {
  const match = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
  const room = readFileSync("supabase/functions/okey_room/index.ts", "utf8");
  const reconciler = readFileSync("okey/server/okey-server-reconciler.ts", "utf8");

  assert.match(match, /reconcileAuthoritativeHumanCommand\(/);
  assert.match(room, /const result = await callRoomAction\(action\)/);
  assert.doesNotMatch(room, /executeAuthoritativeOkeyTurn/);
  assert.match(room, /event: "invalidate"/);
  assert.doesNotMatch(room, /from ["'].*domino/);
});

test("lifecycle decision has one owner in okey-turn-engine", () => {
  const engine = readFileSync("okey/server/okey-turn-engine.ts", "utf8");
  const authoritative = readFileSync("okey/server/okey-authoritative.ts", "utf8");
  const reconciler = readFileSync("okey/server/okey-server-reconciler.ts", "utf8");

  assert.match(engine, /export function evaluateOkeyServerLifecycle/);
  assert.doesNotMatch(authoritative, /export function evaluateOkeyServerLifecycle/);
  assert.doesNotMatch(authoritative, /export type OkeyLifecycleDecision/);
  assert.match(reconciler, /from ["']\.\/okey-turn-engine\.ts["']/);
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

  assert.doesNotMatch(match, /executeAuthoritativeOkeyTransition|commitAuthoritativeOkeyAction/);
  assert.match(match, /reconcileAuthoritativeHumanCommand\(/);
  assert.doesNotMatch(match, /executeAuthoritativeOkeyTurn/);
  assert.doesNotMatch(match, /reduceAuthoritativeOkeyTransition/);
  assert.doesNotMatch(match, /applyAuthoritativeOkeyMatchCommand\(/);
  assert.doesNotMatch(match, /applyAuthoritativeManualLeave\(/);

  assert.doesNotMatch(reconciler, /executeAuthoritativeOkeyTransition/);
  assert.doesNotMatch(reconciler, /executeAuthoritativeOkeyTurn/);
  assert.equal((reconciler.match(/executeOkeyAuthoritativePipeline\(\{/g) ?? []).length, 5);
  assert.equal((reconciler.match(/reduceAuthoritativeOkeyTransition/g) ?? []).length, 2);
  assert.doesNotMatch(reconciler, /function reduceOkeyTransition\(/);
  assert.match(reconciler, /preReducedState: finishingTeamForfeit/);
  assert.doesNotMatch(reconciler, /applyAuthoritativeOkeyEliminatedTurn\(/);
  assert.doesNotMatch(reconciler, /resolveAuthoritativeMatchDeadline\(/);
  assert.doesNotMatch(reconciler, /startAuthoritativeOkeyNextRound\(/);

  assert.equal((bot.match(/executeAuthoritativeOkeyTransition\(\{/g) ?? []).length, 0);
  assert.doesNotMatch(bot, /executeAuthoritativeOkeyTurn/);
  assert.doesNotMatch(bot, /reduceAuthoritativeOkeyTransition/);
  assert.match(bot, /selectOkeyBotIntent/);
  assert.doesNotMatch(bot, /settleAuthoritativeOkeyRound\(\{\s*\.\.\.currentState/);
});
