import assert from 'node:assert/strict';
import test from 'node:test';

import { discardTile, drawTile } from '../../engine/okey-engine.ts';
import {
    createAuthoritativeOkeyMatch,
    getNextOkeyMatchTurnDeadline,
    type OkeyAuthoritativeMatchState,
} from '../okey-authoritative.ts';
import {
    executeOkeyServerLifecycle,
    getOkeyLifecycleRunAt,
    reconcileAuthoritativeServerLifecycleAlarm,
} from '../okey-turn-engine.ts';

const players = [
  { id: 'p1', name: 'P1', controlledByBot: false },
  { id: 'p2', name: 'P2', controlledByBot: false },
  { id: 'p3', name: 'P3', controlledByBot: false },
  { id: 'p4', name: 'P4', controlledByBot: false },
] as const;

test('Human discard schedules an immediate Bot lifecycle alarm that executes exactly one transition', async () => {
  const now = Date.parse('2026-09-13T12:00:00.000Z');
  const base = createAuthoritativeOkeyMatch(players, 0);
  const humanIndex = base.roundState.currentPlayerIndex;
  const botIndex = (humanIndex + 1) % base.roundState.players.length;
  const beforeDiscard = drawTile({
    ...base.roundState,
    players: base.roundState.players.map((player, index) => ({
      ...player,
      controlledByBot: index === botIndex,
    })),
  }, 'deck');
  const afterDiscard = discardTile(
    beforeDiscard,
    beforeDiscard.players[humanIndex].hand[0].id,
  );
  const committedState: OkeyAuthoritativeMatchState = {
    ...base,
    roundState: afterDiscard,
  };

  assert.equal(afterDiscard.currentPlayerIndex, botIndex);
  assert.equal(getNextOkeyMatchTurnDeadline(committedState, now), null);

  const runAt = getOkeyLifecycleRunAt(committedState, null, now);
  assert.equal(runAt, new Date(now).toISOString());
  assert.ok(runAt);

  let commits = 0;
  let currentState = committedState;
  const client: any = {
    rpc: (name: string, args: any) => {
      if (name === 'okey_get_authoritative_bundle' || name === 'okey_get_system_authoritative_bundle') {
        return { single: async () => ({
          data: { status: 'playing', version: 8, state: currentState, turn_deadline_at: null },
          error: null,
        }) };
      }
      if (name === 'okey_commit_authoritative_action') {
        commits += 1;
        currentState = args.p_state;
        return { single: async () => ({
          data: {
            applied: true,
            version: 9,
            state: currentState,
            turn_deadline_at: args.p_turn_deadline_at,
            action_events: args.p_action_events,
          },
          error: null,
        }) };
      }
      throw new Error(`unexpected rpc: ${name}`);
    },
  };

  const alarmResult = await executeOkeyServerLifecycle({
    client,
    matchId: 'human-to-bot',
    requesterUserId: 'p1',
    state: currentState,
    version: 8,
    turnDeadlineAt: null,
    now: () => Date.parse(runAt),
    deterministicCommandId: async () => 'bot-transition-id',
    broadcastStateUpdate: async () => {},
  });

  assert.equal(alarmResult.executed, true);
  assert.equal(alarmResult.botProcessed, true);
  assert.equal(alarmResult.step, 'draw');
  assert.equal(alarmResult.version, 9);
  assert.equal(commits, 1);
});

test('Ghost lifecycle alarms run immediately, preserve a null human deadline, and repeat on return', async () => {
  const now = Date.parse('2026-09-16T12:00:00.000Z');
  const base = createAuthoritativeOkeyMatch(players, 0);
  const ghostIndex = 1;
  let currentVersion = 20;
  let currentState: OkeyAuthoritativeMatchState = {
    ...base,
    roundState: {
      ...base.roundState,
      currentPlayerIndex: ghostIndex,
      hasDrawnThisTurn: false,
      players: base.roundState.players.map((player, index) =>
        index === ghostIndex ? { ...player, eliminated: true } : player,
      ),
    },
  };
  const scheduledRunAts: string[] = [];
  let commitCount = 0;
  const client: any = {
    rpc: (name: string, args: any) => {
      if (name === 'okey_get_authoritative_bundle' || name === 'okey_get_system_authoritative_bundle') {
        return { single: async () => ({
          data: { status: 'playing', version: currentVersion, state: currentState, turn_deadline_at: null },
          error: null,
        }) };
      }
      if (name === 'okey_commit_authoritative_action') {
        commitCount += 1;
        currentVersion = args.p_expected_version + 1;
        currentState = args.p_state;
        return { single: async () => ({
          data: {
            applied: true,
            version: currentVersion,
            state: currentState,
            turn_deadline_at: args.p_turn_deadline_at,
            action_events: args.p_action_events,
          },
          error: null,
        }) };
      }
      throw new Error(`unexpected rpc: ${name}`);
    },
  };

  assert.equal(getOkeyLifecycleRunAt(currentState, null, now), new Date(now).toISOString());
  assert.equal(getNextOkeyMatchTurnDeadline(currentState, now), null);

  const firstAlarm = await reconcileAuthoritativeServerLifecycleAlarm({
    client,
    matchId: 'ghost-lifecycle',
    requesterUserId: 'p1',
    initialVersion: currentVersion,
    runAt: new Date(now).toISOString(),
    now: () => now,
    scheduleLifecycleAlarm: async ({ runAt }) => { scheduledRunAts.push(runAt); },
  });

  assert.equal(firstAlarm.reason, 'eliminated_executed');
  assert.equal(firstAlarm.executed, true);
  assert.equal(firstAlarm.turnDeadlineAt, new Date(now + 15_000).toISOString());
  assert.equal(commitCount, 1);
  assert.equal(scheduledRunAts.length, 1);
  assert.equal(scheduledRunAts[0], new Date(now + 15_000).toISOString());

  currentState = {
    ...currentState,
    roundState: {
      ...currentState.roundState,
      currentPlayerIndex: ghostIndex,
      hasDrawnThisTurn: false,
    },
  };
  assert.equal(getNextOkeyMatchTurnDeadline(currentState, now), null);
  const secondAlarm = await reconcileAuthoritativeServerLifecycleAlarm({
    client,
    matchId: 'ghost-lifecycle',
    requesterUserId: 'p1',
    initialVersion: currentVersion,
    runAt: new Date(now).toISOString(),
    now: () => now,
    scheduleLifecycleAlarm: async ({ runAt }) => { scheduledRunAts.push(runAt); },
  });

  assert.equal(secondAlarm.reason, 'eliminated_executed');
  assert.equal(secondAlarm.executed, true);
  assert.equal(secondAlarm.turnDeadlineAt, new Date(now + 15_000).toISOString());
  assert.equal(commitCount, 2);
  assert.equal(scheduledRunAts.length, 2);
  assert.equal(scheduledRunAts[1], new Date(now + 15_000).toISOString());
});

