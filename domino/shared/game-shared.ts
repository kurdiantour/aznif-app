import type { AvatarId } from '../../types/avatar.ts';
import { FULL_DOMINO_SET } from '@/domino/core/constants/domino-set';
import { dealDominoHands } from '@/domino/core/setup/deal';
import { shuffleArray } from '@/domino/core/setup/shuffle';
import {
  calculateMatchReward,
  getFinalMatchWinner,
} from '@/domino/core/rules/match-rules';
import {
  getHandPipTotal,
  roundToNearestFive,
} from '@/domino/core/engine/kozel-engine';
import type {
  DominoTileData,
  KozelBoardState,
  KozelBranch,
  Player,
  TeamId,
} from '@/domino/types/domino-game';
import type { MutableRefObject } from 'react';
import { assignDominoBotIdentities } from './bot-identity.ts';

export { calculateMatchReward };

export const NEXT_ROUND_COUNTDOWN_SECONDS = 2;

// This timer starts as soon as the round winner is known, while the final tile
// presentation is still on screen (1.34s landing animation + 3s hold).
// Keep the round-result phase alive for exactly another 5s so the revealed
// hands remain visible before the next-round countdown begins.
export const ROUND_RESULT_REVEAL_MS = 9_340;

// 5s for the large Qapat announcement, then 5s for revealed hands.
export const BLOCKED_RESULT_REVEAL_MS = 10_000;

export const ROUND_TRANSITION_SYNC_MS = 1000;

export const MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN = 3;

export {
  DOMINO_HUMAN_TURN_DURATION_SECONDS as PLAYER_TURN_DURATION_SECONDS,
} from './timing/domino-turn-timer.ts';

export type SeatDefinition = {
  id: string;
  name: string;
  avatarId: AvatarId;
  seat: Player['seat'];
  kind: Player['kind'];
  teamId: TeamId;
};

export function createTwoVsTwoSeats(): SeatDefinition[] {
  const botIdentities = assignDominoBotIdentities([
    { id: 'p1', playerIndex: 0 },
    { id: 'p2', playerIndex: 1 },
    { id: 'p3', playerIndex: 2 },
    { id: 'p4', playerIndex: 3 },
  ]);

  return [
    {
      id: 'p1',
      name: 'You',
      avatarId: 'avatar-2',
      seat: 'bottom',
      kind: 'human',
      teamId: 'teamA',
    },
    {
      id: 'p2',
      name: botIdentities.get('p2')!.name,
      avatarId: botIdentities.get('p2')!.avatarId,
      seat: 'left',
      kind: 'bot',
      teamId: 'teamB',
    },
    {
      id: 'p3',
      name: botIdentities.get('p3')!.name,
      avatarId: botIdentities.get('p3')!.avatarId,
      seat: 'top',
      kind: 'bot',
      teamId: 'teamA',
    },
    {
      id: 'p4',
      name: botIdentities.get('p4')!.name,
      avatarId: botIdentities.get('p4')!.avatarId,
      seat: 'right',
      kind: 'bot',
      teamId: 'teamB',
    },
  ];
}

export function getInitialDeal(seatCount: number) {
  let nextDeal = dealDominoHands(
    shuffleArray(FULL_DOMINO_SET),
    seatCount,
  );

  while (
    !nextDeal.hands.some((hand) =>
      hand.some((tile) => tile.left === 6 && tile.right === 6),
    )
  ) {
    nextDeal = dealDominoHands(
      shuffleArray(FULL_DOMINO_SET),
      seatCount,
    );
  }

  return nextDeal;
}

export function pickPreferredBranch(
  branches: KozelBranch[],
  priority: KozelBranch[],
): KozelBranch {
  return (
    priority.find((branch) => branches.includes(branch)) ??
    branches[0]
  );
}

export function getBlockedRoundWinnerIndex1v1(
  blockedHands: DominoTileData[][],
) {
  const firstTotal = getHandPipTotal(blockedHands[0] ?? []);
  const secondTotal = getHandPipTotal(blockedHands[1] ?? []);

  return firstTotal <= secondTotal ? 0 : 1;
}

export function resolveBlockedRound2v2(
  blockedHands: DominoTileData[][],
  blockerIndex: number,
  seats: SeatDefinition[],
  teamScoresRef: MutableRefObject<Record<TeamId, number>>,
  addTeamPoints: (
    teamId: TeamId,
    points: number,
    playerId: string,
    openEndsTotal: number,
  ) => void,
  setRoundWinnerPlayerId: (value: string | null) => void,
  setLeaderIndex: (value: number) => void,
  setNextRoundLeaderIndex: (value: number) => void,
) {
  let lowestIndex = 0;
  let lowestTotal = getHandPipTotal(blockedHands[0] ?? []);

  for (let index = 1; index < seats.length; index += 1) {
    const total = getHandPipTotal(blockedHands[index] ?? []);

    if (total < lowestTotal) {
      lowestTotal = total;
      lowestIndex = index;
    }
  }

  const scoreWinner = seats[lowestIndex];
  const scoreWinnerTeam = scoreWinner.teamId;

  const opponentPips = blockedHands.reduce(
    (sum, hand, index) => {
      const player = seats[index];

      if (player.teamId === scoreWinnerTeam) {
        return sum;
      }

      return sum + getHandPipTotal(hand);
    },
    0,
  );

  const blockScore = roundToNearestFive(opponentPips);

  if (blockScore > 0) {
    addTeamPoints(
      scoreWinnerTeam,
      blockScore,
      scoreWinner.id,
      opponentPips,
    );
  }

  setRoundWinnerPlayerId(scoreWinner.id);
  setLeaderIndex(blockerIndex);
  setNextRoundLeaderIndex(blockerIndex);

  return true;
}

export function awardEndOfHandPoints2v2(
  winnerTeamId: TeamId,
  winnerPlayerId: string,
  finalHands: DominoTileData[][],
  seats: SeatDefinition[],
  addTeamPoints: (
    teamId: TeamId,
    points: number,
    playerId: string,
    openEndsTotal: number,
  ) => void,
) {
  const opponentPips = seats.reduce(
    (sum, player, index) => {
      if (player.teamId === winnerTeamId) {
        return sum;
      }

      return sum + getHandPipTotal(finalHands[index] ?? []);
    },
    0,
  );

  const endOfHandScore = roundToNearestFive(opponentPips);

  if (endOfHandScore > 0) {
    addTeamPoints(
      winnerTeamId,
      endOfHandScore,
      winnerPlayerId,
      opponentPips,
    );
  }
}

export function evaluateFinalWinner(
  scores: Record<TeamId, number>,
  setWinningTeamId: (value: TeamId | null) => void,
) {
  const winner = getFinalMatchWinner(scores);

  if (winner) {
    setWinningTeamId(winner);
  }
}