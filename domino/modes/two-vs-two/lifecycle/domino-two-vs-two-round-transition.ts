import { createEmptyBoard } from '../../../core/engine/kozel-engine.ts';
import { getNextHandKingIndex } from '../../../core/rules/king-rules.ts';
import {
  reduceTwoVsTwoStartNextHand,
  type TwoVsTwoPlayer,
  type TwoVsTwoTransition,
} from '../authoritative/domino-two-vs-two-command-reducer.ts';

const NORMAL_ROUND_TRANSITION_MS = 11_340;
const BLOCKED_ROUND_TRANSITION_MS = 12_000;

type RandomSource = () => number;

function createDominoSet() {
  const tiles = [];

  for (let left = 0; left <= 6; left += 1) {
    for (let right = left; right <= 6; right += 1) {
      tiles.push({
        id: `${left}-${right}`,
        left,
        right,
        imageKey: `${left}-${right}`,
      });
    }
  }

  return tiles;
}

export function dealTwoVsTwoNextRound(random: RandomSource) {
  const tiles = createDominoSet();

  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [tiles[index], tiles[swapIndex]] = [tiles[swapIndex], tiles[index]];
  }

  return [
    tiles.slice(0, 7),
    tiles.slice(7, 14),
    tiles.slice(14, 21),
    tiles.slice(21, 28),
  ];
}

export function createSeededRandom(seed: number): RandomSource {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function finalizeTwoVsTwoRound(input: {
  transition: TwoVsTwoTransition;
  players: TwoVsTwoPlayer[];
  roomId: string;
  committedVersion: number;
  completedAt: string;
  shuffleSeed: number;
}): TwoVsTwoTransition {
  const completed = input.transition.nextState;

  if (!completed.roundWinnerPlayerId || completed.winningTeamId) {
    return input.transition;
  }

  const transitionDuration =
    completed.roundEndReason === 'blocked'
      ? BLOCKED_ROUND_TRANSITION_MS
      : NORMAL_ROUND_TRANSITION_MS;

  const presentationEndsAt = new Date(
    Date.parse(input.completedAt) + transitionDuration,
  ).toISOString();

  const leaderIndex = getNextHandKingIndex(
    input.players,
    completed.leaderPlayerId ?? completed.roundWinnerPlayerId,
  );

  const leaderPlayerId =
    input.players[leaderIndex]?.user_id ??
    input.players[0]?.user_id;

  if (!leaderPlayerId) {
    throw new Error('domino_2v2_next_round_leader_missing');
  }

  const completedRound = {
    id: `${input.roomId}:${input.committedVersion}`,
    winnerPlayerId: completed.roundWinnerPlayerId,
    endReason: completed.roundEndReason ?? null,
    endOfHandScoringEvent:
      completed.endOfHandScoringEvent ?? null,
    hands: input.transition.nextHands,
    completedAt: input.completedAt,
    presentationEndsAt,
  };

  return reduceTwoVsTwoStartNextHand({
    state: completed,
    hands: dealTwoVsTwoNextRound(
      createSeededRandom(input.shuffleSeed),
    ),
    leaderPlayerId,
    phaseStartedAt: presentationEndsAt,
    emptyBoard: createEmptyBoard(),
    completedRound,
  });
}

export function isTwoVsTwoRoundTransitionPending(
  state: Record<string, any>,
  nowMs = Date.now(),
) {
  const presentationEndsAt = Date.parse(
    state?.lastCompletedRound?.presentationEndsAt ?? '',
  );

  return (
    Number.isFinite(presentationEndsAt) &&
    nowMs < presentationEndsAt
  );
}