import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeTwoVsTwoRound } from '../lifecycle/domino-two-vs-two-round-transition.ts';

const players = [
  { user_id: 'p0', team_id: 'teamA' as const, player_index: 0 },
  { user_id: 'p1', team_id: 'teamB' as const, player_index: 1 },
  { user_id: 'p2', team_id: 'teamA' as const, player_index: 2 },
  { user_id: 'p3', team_id: 'teamB' as const, player_index: 3 },
];

const completedTransition = {
  nextState: {
    teamScores: { teamA: 25, teamB: 10 },
    roundWinnerPlayerId: 'p2',
    roundEndReason: 'empty_hand',
    leaderPlayerId: 'p2',
    endOfHandScoringEvent: { playerId: 'p2', teamId: 'teamA', points: 10 },
  },
  nextHands: [[{ id: '0-0', left: 0, right: 0 }], [], [], []],
  nextBoneyard: [],
  nextTurnPlayerId: 'p2',
  status: 'active' as const,
};

test('2v2 round completion atomically projects one deterministic next-round snapshot', () => {
  const input = {
    transition: completedTransition,
    players,
    roomId: 'room',
    committedVersion: 8,
    completedAt: '2026-08-20T00:00:00.000Z',
    shuffleSeed: 12345,
  };
  const first = finalizeTwoVsTwoRound(input);
  const second = finalizeTwoVsTwoRound(input);

  assert.deepEqual(first, second);
  assert.equal(first.nextState.lastCompletedRound.id, 'room:8');
  assert.equal(first.nextState.lastCompletedRound.winnerPlayerId, 'p2');
  assert.deepEqual(first.nextState.lastCompletedRound.hands, completedTransition.nextHands);
  assert.equal(first.nextState.currentTurnPlayerId, 'p2');
  assert.equal(first.nextState.roundWinnerPlayerId, 'p2');
  assert.equal(first.nextState.roundStartsAt, '2026-08-20T00:00:11.340Z');
  assert.deepEqual(first.nextState.handCounts, [7, 7, 7, 7]);
  assert.equal(first.nextHands.flat().length, 28);
  assert.equal(new Set(first.nextHands.flat().map((tile) => tile.id)).size, 28);
});

test('2v2 terminal score outcome never creates another round', () => {
  const terminal = {
    ...completedTransition,
    nextState: { ...completedTransition.nextState, winningTeamId: 'teamA' },
  };
  assert.equal(finalizeTwoVsTwoRound({
    transition: terminal,
    players,
    roomId: 'room',
    committedVersion: 9,
    completedAt: '2026-08-20T00:00:00.000Z',
    shuffleSeed: 1,
  }), terminal);
});
