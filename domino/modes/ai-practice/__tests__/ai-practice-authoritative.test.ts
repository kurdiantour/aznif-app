import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMove, createEmptyBoard } from '../../../core/engine/kozel-engine.ts';
import {
  reduceAiPracticeHumanDraw,
  reduceAiPracticePass,
} from '../authoritative/ai-practice-command-reducer.ts';

const seats = [
  { id: 'human', teamId: 'teamA', kind: 'human' },
  { id: 'bot', teamId: 'teamB', kind: 'bot' },
];
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
