import assert from 'node:assert/strict';
import test from 'node:test';

import { discardTile, drawTile } from '../../engine/okey-engine.ts';
import {
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
  type OkeyAuthoritativeMatchState,
} from '../okey-authoritative.ts';
import {
  getOkeyLifecycleWakeupAt,
  reconcileAuthoritativeBotTurn,
} from '../okey-server-reconciler.ts';

const players = [
  { id: 'p1', name: 'P1', controlledByBot: false },
  { id: 'p2', name: 'P2', controlledByBot: false },
  { id: 'p3', name: 'P3', controlledByBot: false },
  { id: 'p4', name: 'P4', controlledByBot: false },
] as const;

test('Human discard schedules an immediate Bot wakeup that executes exactly one transition', async () => {
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
  assert.equal(afterDiscard.pendingBotTurnAdvanceAt ?? null, null);
  assert.equal(getNextOkeyMatchTurnDeadline(committedState, now), null);

  const runAt = getOkeyLifecycleWakeupAt(committedState, null, now);
  assert.equal(runAt, new Date(now).toISOString());
  assert.ok(runAt);

  let commits = 0;
  let currentState = committedState;
  const client: any = {
    rpc: (name: string, args: any) => {
      if (name === 'okey_get_authoritative_bundle') {
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
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { is_test: false }, error: null }),
          }),
        }),
      }),
    }),
  };

  const alarmResult = await reconcileAuthoritativeBotTurn({
    matchId: 'human-to-bot',
    requesterUserId: 'p1',
    expectedVersion: 8,
    expectedActorId: afterDiscard.players[botIndex].id,
  }, {
    client,
    now: () => Date.parse(runAt),
    deterministicCommandId: async () => 'bot-transition-id',
    broadcastStateUpdate: async () => {},
  });

  assert.equal(alarmResult.processed, true);
  assert.equal(alarmResult.step, 'draw');
  assert.equal(alarmResult.finalVersion, 9);
  assert.equal(commits, 1);
});
