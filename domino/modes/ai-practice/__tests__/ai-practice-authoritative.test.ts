import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiPracticeSeats } from '../engine/ai-practice-engine.ts';
import { applyMove, createEmptyBoard } from '../../../core/engine/kozel-engine.ts';
import {
  reduceAiPracticeBlocked,
  reduceAiPracticeHumanDraw,
  reduceAiPracticePlay,
  reduceAiPracticePass,
} from '../authoritative/ai-practice-command-reducer.ts';

const humanUserId = '12345678-1234-4234-8234-123456789abc';
const seats = createAiPracticeSeats(humanUserId);

test('AI Practice uses the account UUID while keeping hand ownership at index zero', () => {
  assert.equal(seats[0].id, humanUserId);
  assert.equal(seats[0].kind, 'human');
  assert.equal(seats[0].seat, 'bottom');
  const state = base();
  const passed = reduceAiPracticePass(state, 0, true);
  assert.equal(passed.accepted, true);
  assert.equal(passed.lastPassedPlayerId, humanUserId);
  assert.equal(passed.state.currentIndex, 1);
  assert.equal(passed.state.hands, state.hands);
});

const base = () => ({
  seats,
  currentIndex: 0,
  leaderIndex: 0,
  board: applyMove(
    createEmptyBoard(),
    { id: '6-6', left: 6, right: 6, imageKey: '6-6' },
    'right',
    null,
    true,
  ).board,
  hands: [[{ id: '1-2', left: 1, right: 2, imageKey: '1-2' }], []],
  boneyard: [{ id: '2-6', left: 2, right: 6, imageKey: '2-6' }],
  spinnerValue: null,
  isOpeningRound: false,
  openingDouble: null,
  roundWinnerPlayerId: null,
  winningTeamId: null,
  teamScores: { teamA: 0, teamB: 0 },
  humanDrawsThisTurn: 0,
  lastTilePlayerIndex: 1,
});

test('AI Practice pass remains rejected while the human can still draw', () => {
  assert.equal(reduceAiPracticePass(base(), 0).accepted, false);
});

test('AI Practice human draw is a local authoritative transition', () => {
  const result = reduceAiPracticeHumanDraw(base(), 0);
  assert.equal(result.accepted, true);
  assert.equal(result.state.hands[0].length, 2);
  assert.equal(result.state.boneyard.length, 0);
});

test('AI Practice empty hand commits final match outcome with the round winner for human and bot', () => {
  const finalTile = { id: '6-1', left: 6, right: 1, imageKey: '6-1' };
  for (const playerIndex of [0, 1]) {
    const state = base();
    state.currentIndex = playerIndex;
    state.hands = playerIndex === 0
      ? [[finalTile], [{ id: '1-4', left: 1, right: 4, imageKey: '1-4' }]]
      : [[{ id: '1-4', left: 1, right: 4, imageKey: '1-4' }], [finalTile]];
    state.teamScores = playerIndex === 0
      ? { teamA: 345, teamB: 0 }
      : { teamA: 0, teamB: 345 };

    const result = reduceAiPracticePlay(state, finalTile, playerIndex, 'right');
    const winner = seats[playerIndex];
    assert.equal(result.accepted, true);
    assert.equal(result.state.roundWinnerPlayerId, winner.id);
    assert.equal(result.state.winningTeamId, winner.teamId);
    assert.ok(result.state.teamScores[winner.teamId] >= 350);
  }
});

test('AI Practice blocked round commits final match outcome with the round winner', () => {
  const state = base();
  state.hands = [
    [{ id: '3-4', left: 3, right: 4, imageKey: '3-4' }],
    [{ id: '1-1', left: 1, right: 1, imageKey: '1-1' }],
  ];
  state.teamScores = { teamA: 0, teamB: 345 };

  const result = reduceAiPracticeBlocked(state, 0);
  assert.equal(result.accepted, true);
  assert.equal(result.state.roundWinnerPlayerId, seats[1].id);
  assert.equal(result.state.winningTeamId, 'teamB');
  assert.ok(result.state.teamScores.teamB >= 350);
});
