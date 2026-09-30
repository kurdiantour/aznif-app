import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createAuthoritativeOkeyMatch } from "../okey-authoritative.ts";
import { reconcileAuthoritativeHumanCommand } from "../okey-turn-engine.ts";

type HumanInput = Parameters<typeof reconcileAuthoritativeHumanCommand>[0];
type Bundle = HumanInput["bundle"];
type CommitParameters = {
  p_expected_version: number;
  p_command_id: string;
  p_state: Bundle["state"];
  p_projection: { version: number };
  p_turn_deadline_at: string | null;
};

function retryFixture(errors: (string | null)[]) {
  const state = createAuthoritativeOkeyMatch([
    { id: "p1", name: "One" }, { id: "p2", name: "Two" },
    { id: "p3", name: "Three" }, { id: "p4", name: "Four" },
  ], 0);
  const bundle: Bundle = {
    state, version: 7, player_index: state.roundState.currentPlayerIndex,
    turn_deadline_at: "2026-09-14T10:01:00.000Z", command_applied: false,
  };
  const input: HumanInput = {
    action: "manual-leave", matchId: "retry-match",
    actorUserId: state.roundState.players[bundle.player_index].id,
    commandId: "same-command", command: null, clientExpectedVersion: 7,
    commandReceivedAtMs: Date.parse("2026-09-14T10:00:00.000Z"), bundle,
  };
  const commits: CommitParameters[] = [];
  const broadcasts: number[] = [];
  const alarms: number[] = [];
  let reloadCount = 0;
  let reload: () => Bundle | null = () => ({
    ...bundle, version: 7 + reloadCount,
    state: { ...state, currentRound: 2 },
  });
  const dependencies: Parameters<typeof reconcileAuthoritativeHumanCommand>[1] = {
    client: {
      rpc(name: string, parameters: CommitParameters) {
        assert.equal(name, "okey_commit_authoritative_action_with_events");
        commits.push(parameters);
        assert.ok(commits.length <= errors.length, "unexpected additional commit attempt");
        const error = errors[commits.length - 1];
        return { single: async () => error
          ? { data: null, error: { message: error } }
          : { data: { applied: true, version: parameters.p_expected_version + 1,
              state: parameters.p_state, turn_deadline_at: parameters.p_turn_deadline_at,
              action_events: [] }, error: null } };
      },
    },
    deterministicCommandId: async source => source,
    now: () => input.commandReceivedAtMs,
    reloadBundle: async () => { reloadCount++; return reload(); },
    broadcastStateUpdate: async payload => { broadcasts.push(payload.version); },
    scheduleLifecycleAlarm: async payload => { alarms.push(payload.version); },
  };
  return { input, dependencies, commits, broadcasts, alarms,
    reloadCount: () => reloadCount,
    setReload: (value: () => Bundle | null) => { reload = value; },
    run: () => reconcileAuthoritativeHumanCommand(input, dependencies) };
}

const read = (path: string) => readFileSync(path, "utf8");

test("manual leave retries conflicts with fresh state/version and a stable command ID", async () => {
  const f = retryFixture(["version_conflict", null]);
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(f.reloadCount(), 1);
  assert.deepEqual(f.commits.map(c => c.p_expected_version), [7, 8]);
  assert.deepEqual(f.commits.map(c => c.p_projection.version), [8, 9]);
  assert.deepEqual(f.commits.map(c => c.p_command_id), ["same-command", "same-command"]);
  assert.equal(f.commits[1].p_state.currentRound, 2, "retry must reduce the reloaded state");
  assert.ok(f.commits[1].p_state.manualLeftPlayerIds.includes(f.input.actorUserId));
  assert.deepEqual(f.broadcasts, [9]);
  assert.deepEqual(f.alarms, [9]);
  if (result.ok) assert.equal(result.version, 9);
});

test("manual leave permits success on the third and final commit attempt", async () => {
  const f = retryFixture(["version_conflict", "version_conflict", null]);
  assert.equal((await f.run()).ok, true);
  assert.equal(f.reloadCount(), 2);
  assert.deepEqual(f.commits.map(c => c.p_expected_version), [7, 8, 9]);
  assert.deepEqual(f.broadcasts, [10]);
  assert.deepEqual(f.alarms, [10]);
});

test("three manual leave conflicts stop with version_conflict and no publication", async () => {
  const f = retryFixture(["version_conflict", "version_conflict", "version_conflict"]);
  const result = await f.run();
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.error, "version_conflict"); assert.equal(result.status, 409); }
  assert.equal(f.commits.length, 3);
  assert.equal(f.reloadCount(), 2);
  assert.deepEqual(f.broadcasts, []);
  assert.deepEqual(f.alarms, []);
});

for (const scenario of ["human-conflict", "manual-non-conflict"] as const) {
  test(scenario + " stops after one attempt without reloading or publication", async () => {
    const human = scenario === "human-conflict";
    const f = retryFixture([human ? "version_conflict" : "database_unavailable"]);
    if (human) {
      f.input.action = "command";
      f.input.command = { type: "draw", source: "deck" };
      f.input.bundle.state.roundState.hasDrawnThisTurn = false;
    }
    const result = await f.run();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, human ? "version_conflict" : "commit_failed");
    assert.equal(f.commits.length, 1);
    assert.equal(f.reloadCount(), 0);
    assert.deepEqual(f.broadcasts, []);
    assert.deepEqual(f.alarms, []);
  });
}

test("failed manual leave reload stops before another commit", async () => {
  const f = retryFixture(["version_conflict"]);
  f.setReload(() => null);
  const result = await f.run();
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.error, "manual_leave_retry_fetch_failed"); assert.equal(result.status, 409); }
  assert.equal(f.commits.length, 1);
  assert.equal(f.reloadCount(), 1);
  assert.deepEqual(f.broadcasts, []);
  assert.deepEqual(f.alarms, []);
});

for (const alreadyApplied of ["command", "membership"] as const) {
  test("reloaded " + alreadyApplied + " confirms leave without another commit", async () => {
    const f = retryFixture(["version_conflict"]);
    f.setReload(() => ({ ...f.input.bundle, version: 12,
      command_applied: alreadyApplied === "command",
      state: { ...f.input.bundle.state,
        manualLeftPlayerIds: alreadyApplied === "membership" ? [f.input.actorUserId] : [] },
    }));
    const result = await f.run();
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.version, 12);
    assert.equal(f.commits.length, 1);
    assert.equal(f.reloadCount(), 1);
    assert.deepEqual(f.broadcasts, []);
    assert.deepEqual(f.alarms, []);
  });
}

test("Edge wires manual leave reload and adapter awaits authoritative leave before room cleanup", () => {
  const edge = read("supabase/functions/okey_match/index.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");
  assert.match(edge, /reloadBundle:\s*loadAuthoritativeBundle/);
  assert.match(adapter, /notAppliedOnError:[\s\S]*manual_leave_retry_exhausted/);
  assert.match(adapter, /await this\.runAuthoritativeMutation\([\s\S]*await leaveOkeyRoom/);
});

test("lifecycle alarms are one-shot, version-bound, and only chain after a committed transition", () => {
  const scheduler = read("supabase/functions/_shared/aznif-game-lifecycle.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");
  const engine = read("okey/server/okey-turn-engine.ts");

  assert.match(scheduler, /expectedVersion: input\.expectedVersion/);
  assert.doesNotMatch(worker, /result\?\.executed === true/);
  assert.match(worker, /initialVersion: Number\(expected_version\)/);
  assert.doesNotMatch(worker, /eligible_at|turn_deadline_at/);
  assert.doesNotMatch(engine, /dispatchContinuation|reconcileAuthoritativeServerScheduler/);
  const lifecycleAlarmSource = engine.slice(
    engine.indexOf("export async function reconcileAuthoritativeServerLifecycleAlarm"),
  );
  assert.doesNotMatch(lifecycleAlarmSource, /refreshAfterInitialSleep|retryIntervalMs|maxRetryDurationMs|await sleep\(|while\s*\(/);
  assert.equal((lifecycleAlarmSource.match(/await executeOkeyServerLifecycle\(\{/g) ?? []).length, 1);
  assert.match(lifecycleAlarmSource, /version !== Number\(options\.initialVersion\)/);
});

