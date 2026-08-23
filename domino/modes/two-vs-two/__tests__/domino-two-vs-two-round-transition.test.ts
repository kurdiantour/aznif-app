import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finalizeTwoVsTwoRound,
  getTwoVsTwoNextHandDisposition,
  startTwoVsTwoNextHand,
} from '../lifecycle/domino-two-vs-two-round-transition.ts';
import { isDominoTwoVsTwoMoveCommitted } from '../controllers/domino-two-vs-two-controller.ts';
import { canSubmitDominoTwoVsTwoTurn } from '../lifecycle/domino-two-vs-two-lifecycle.ts';

const players = [
  { user_id: 'p0', team_id: 'teamA' as const, player_index: 0 },
  { user_id: 'p1', team_id: 'teamB' as const, player_index: 1 },
  { user_id: 'p2', team_id: 'teamA' as const, player_index: 2 },
  { user_id: 'p3', team_id: 'teamB' as const, player_index: 3 },
];

const finalBoard = { centerTile: { id: '5-5', left: 5, right: 5 }, branches: {} };
const completedTransition = {
  nextState: {
    status: 'active',
    board: finalBoard,
    handCounts: [1, 0, 2, 3],
    teamScores: { teamA: 25, teamB: 10 },
    roundWinnerPlayerId: 'p2',
    roundEndReason: 'empty_hand',
    leaderPlayerId: 'p2',
    currentTurnPlayerId: 'p2',
    turnStartedAt: '2026-08-20T00:00:00.000Z',
    endOfHandScoringEvent: { playerId: 'p2', teamId: 'teamA', points: 10 },
  },
  nextHands: [[{ id: '0-0', left: 0, right: 0 }], [], [{ id: '1-1', left: 1, right: 1 }], []],
  nextBoneyard: [],
  nextTurnPlayerId: 'p2',
  status: 'active' as const,
};

test('human last tile commits an authoritative round-finished snapshot before any new deal', () => {
  const finished = finalizeTwoVsTwoRound({
    transition: completedTransition,
    roomId: 'room',
    committedVersion: 8,
    completedAt: '2026-08-20T00:00:00.000Z',
  });

  assert.equal(finished.nextState.roundWinnerPlayerId, 'p2');
  assert.equal(finished.nextState.roundEndReason, 'empty_hand');
  assert.equal(finished.nextState.currentTurnPlayerId, null);
  assert.equal(finished.nextState.roundStartsAt, null);
  assert.equal(finished.nextState.board, finalBoard);
  assert.deepEqual(finished.nextHands, completedTransition.nextHands);
  assert.equal(finished.nextState.lastCompletedRound.id, 'room:8');
  assert.deepEqual(finished.nextState.lastCompletedRound.hands, completedTransition.nextHands);
  assert.equal(canSubmitDominoTwoVsTwoTurn(finished.nextState), false);
});

test('authoritative start-next-hand performs the deal only after the finished snapshot', () => {
  const finished = finalizeTwoVsTwoRound({
    transition: completedTransition,
    roomId: 'room',
    committedVersion: 8,
    completedAt: '2026-08-20T00:00:00.000Z',
  });
  const startedAt = '2026-08-20T00:00:20.000Z';
  const first = startTwoVsTwoNextHand({
    state: finished.nextState,
    players,
    startedAt,
    shuffleSeed: 12345,
  });
  const second = startTwoVsTwoNextHand({
    state: finished.nextState,
    players,
    startedAt,
    shuffleSeed: 12345,
  });

  assert.deepEqual(first, second);
  assert.equal(first.nextState.roundWinnerPlayerId, null);
  assert.equal(first.nextState.roundEndReason, null);
  assert.equal(first.nextState.currentTurnPlayerId, 'p2');
  assert.equal(first.nextState.leaderPlayerId, 'p2');
  assert.equal(first.nextState.turnStartedAt, startedAt);
  assert.equal(first.nextState.roundStartsAt, startedAt);
  assert.equal(first.nextState.board.centerTile, null);
  assert.deepEqual(first.nextState.handCounts, [7, 7, 7, 7]);
  assert.equal(first.nextHands.flat().length, 28);
  assert.equal(new Set(first.nextHands.flat().map((tile) => tile.id)).size, 28);
  assert.equal(first.nextState.lastCompletedRound.id, 'room:8');
  assert.equal(canSubmitDominoTwoVsTwoTurn(first.nextState), true);
});

test('concurrent start-next-hand callers converge on one started hand', () => {
  const finished = finalizeTwoVsTwoRound({
    transition: completedTransition,
    roomId: 'room',
    committedVersion: 8,
    completedAt: '2026-08-20T00:00:00.000Z',
  });
  const completedRoundId = finished.nextState.lastCompletedRound.id;
  assert.equal(
    getTwoVsTwoNextHandDisposition(finished.nextState, completedRoundId),
    'ready',
  );

  const started = startTwoVsTwoNextHand({
    state: finished.nextState,
    players,
    startedAt: '2026-08-20T00:00:20.000Z',
    shuffleSeed: 12345,
  });
  assert.equal(
    getTwoVsTwoNextHandDisposition(started.nextState, completedRoundId),
    'already_started',
  );
  assert.equal(
    getTwoVsTwoNextHandDisposition(started.nextState, 'room:older'),
    'stale',
  );
});
test('terminal round is preserved for result presentation and cannot start another hand', () => {
  const terminal = finalizeTwoVsTwoRound({
    transition: {
      ...completedTransition,
      nextState: { ...completedTransition.nextState, winningTeamId: 'teamA' },
    },
    roomId: 'room',
    committedVersion: 9,
    completedAt: '2026-08-20T00:00:00.000Z',
  });

  assert.equal(terminal.nextState.roundWinnerPlayerId, 'p2');
  assert.equal(terminal.nextState.winningTeamId, 'teamA');
  assert.throws(
    () => startTwoVsTwoNextHand({
      state: terminal.nextState,
      players,
      startedAt: '2026-08-20T00:00:20.000Z',
      shuffleSeed: 1,
    }),
    /round_not_ready_for_next_hand/,
  );
});

test('last-tile optimistic move reconciles against the committed final board', () => {
  const pendingMove = {
    requestId: 'room:5-5:12345678',
    roomId: 'room',
    tile: { id: '5-5', left: 5, right: 5, imageKey: '5-5' },
    branch: 'left' as const,
    baseVersion: 5,
    visualBoard: finalBoard as any,
  };
  const isCommitted = isDominoTwoVsTwoMoveCommitted(
    { board: { centerTile: pendingMove.tile, branches: {} } },
    6,
    pendingMove,
  );
  assert.equal(isCommitted, true);
});