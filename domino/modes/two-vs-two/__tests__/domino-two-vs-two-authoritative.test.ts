import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reduceTwoVsTwoBotPass,
  reduceTwoVsTwoPass,
  reduceTwoVsTwoPlay,
} from '../authoritative/domino-two-vs-two-command-reducer.ts';

const players = [
  { user_id: 'p0', team_id: 'teamA' as const, player_index: 0 },
  { user_id: 'p1', team_id: 'teamB' as const, player_index: 1 },
  { user_id: 'p2', team_id: 'teamA' as const, player_index: 2 },
  { user_id: 'p3', team_id: 'teamB' as const, player_index: 3 },
];

test('2v2 play keeps team scoring and completes only the current round', () => {
  const tile = { id: '6-6', left: 6, right: 6 };
  const result = reduceTwoVsTwoPlay({
    state: { teamScores: { teamA: 0, teamB: 0 }, matchReward: null },
    hands: [[tile], [{ id: '1-2', left: 1, right: 2 }], [], []],
    boneyard: [],
    players,
    playerIndex: 0,
    actorUserId: 'p0',
    tile,
    nextBoard: { centerTile: tile },
    nextSpinnerValue: 6,
    moveScore: 10,
    phaseStartedAt: '2026-01-01T00:00:00.000Z',
    isSameTile: (left, right) => left.id === right.id,
    canAnyPlayerMove: () => true,
  });
  assert.equal(result.nextState.roundWinnerPlayerId, 'p0');
  assert.equal(result.nextState.roundEndReason, 'empty_hand');
  assert.equal(result.nextState.teamScores.teamA, 15);
  assert.equal(result.status, 'active');
});

test('2v2 timeout pass waives only the opening constraint and advances clockwise', () => {
  const result = reduceTwoVsTwoPass({
    state: { isOpeningRound: true, isFirstRound: true, blockedPasses: [] },
    hands: [[], [], [], []],
    boneyard: [],
    players,
    playerIndex: 0,
    currentTurnPlayerId: 'p0',
    timedOut: true,
    phaseStartedAt: '2026-01-01T00:00:20.000Z',
  });
  assert.equal(result.nextTurnPlayerId, 'p1');
  assert.equal(result.nextState.isOpeningRound, false);
  assert.deepEqual(result.nextState.blockedPasses, ['p0']);
});

test('2v2 bot pass preserves the current turn timestamp policy', () => {
  const result = reduceTwoVsTwoBotPass({
    state: { turnStartedAt: 'original', blockedPasses: [] },
    hands: [[], [], [], []],
    boneyard: [],
    players,
    playerIndex: 0,
    currentTurnPlayerId: 'p0',
  });
  assert.equal(result.nextState.turnStartedAt, 'original');
  assert.equal(result.nextTurnPlayerId, 'p1');
});
