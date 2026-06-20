import type { AvatarId } from '@/constants/avatars';
import { FULL_DOMINO_SET } from '@/constants/domino-set';
import { dealDominoHands } from '@/lib/domino/deal';
import { shuffleArray } from '@/lib/domino/shuffle';
import { calculateMatchReward, getFinalMatchWinner } from '@/lib/game/match-rules';
import {
    getHandPipTotal,
    roundToNearestFive,
} from '@/lib/game/kozel-engine';
import {
    DominoTileData,
    KozelBoardState,
    KozelBranch,
    Player,
    TeamId,
} from '@/types/game';
import { MutableRefObject } from 'react';

export { calculateMatchReward };

export const NEXT_ROUND_COUNTDOWN_SECONDS = 2;
export const ROUND_RESULT_REVEAL_MS = 8000;
export const ROUND_TRANSITION_SYNC_MS = 1000;
export const MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN = 3;
export const PLAYER_TURN_DURATION_SECONDS = 20;

export type SeatDefinition = {
  id: string;
  name: string;
  avatarId: AvatarId;
  seat: Player['seat'];
  kind: Player['kind'];
  teamId: TeamId;
};

export function createTwoVsTwoSeats(): SeatDefinition[] {
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
      name: 'Sara',
      avatarId: 'avatar-1',
      seat: 'left',
      kind: 'bot',
      teamId: 'teamB',
    },
    {
      id: 'p3',
      name: 'AI Bot',
      avatarId: 'bot-avatar',
      seat: 'top',
      kind: 'bot',
      teamId: 'teamA',
    },
    {
      id: 'p4',
      name: 'Miran',
      avatarId: 'avatar-4',
      seat: 'right',
      kind: 'bot',
      teamId: 'teamB',
    },
  ];
}

export function getInitialDeal(seatCount: number) {
  let nextDeal = dealDominoHands(shuffleArray(FULL_DOMINO_SET), seatCount);

  while (
    !nextDeal.hands.some((hand) =>
      hand.some((tile) => tile.left === 6 && tile.right === 6),
    )
  ) {
    nextDeal = dealDominoHands(shuffleArray(FULL_DOMINO_SET), seatCount);
  }

  return nextDeal;
}

export function pickPreferredBranch(
  branches: KozelBranch[],
  priority: KozelBranch[],
): KozelBranch {
  return priority.find((branch) => branches.includes(branch)) ?? branches[0];
}

export function getBlockedRoundWinnerIndex1v1(
  blockedHands: DominoTileData[][],
) {
  const firstTotal = getHandPipTotal(blockedHands[0] ?? []);
  const secondTotal = getHandPipTotal(blockedHands[1] ?? []);

  return firstTotal <= secondTotal ? 0 : 1;
}

export function canDrawTileFor1v1(
  playerIndex: number,
  currentIndex: number,
  board: KozelBoardState,
  roundWinnerPlayerId: string | null,
  winningTeamId: TeamId | null,
  hasPlayableTile: boolean,
  boneyardLength: number,
) {
  return (
    playerIndex === 0 &&
    currentIndex === 0 &&
    !!board.centerTile &&
    !roundWinnerPlayerId &&
    !winningTeamId &&
    !hasPlayableTile &&
    boneyardLength > 0
  );
}

export function shouldRefusePassBecauseDrawAvailable1v1(
  playerIndex: number,
  board: KozelBoardState,
  boneyardLength: number,
  hasPlayableTile: boolean,
) {
  return (
    playerIndex === 0 &&
    !!board.centerTile &&
    boneyardLength > 0 &&
    !hasPlayableTile
  );
}

export function resolveBlockedRound1v1(
  blockedHands: DominoTileData[][],
  _blockerIndex: number,
  seats: SeatDefinition[],
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
  const playerIndex = getBlockedRoundWinnerIndex1v1(blockedHands);
  const scoreWinner = seats[playerIndex];

  const opponentPips = blockedHands[(playerIndex + 1) % 2].reduce(
    (sum, tile) => sum + tile.left + tile.right,
    0,
  );

  const blockScore = roundToNearestFive(opponentPips);

  if (blockScore > 0) {
    addTeamPoints(scoreWinner.teamId, blockScore, scoreWinner.id, opponentPips);
  }

  setRoundWinnerPlayerId(scoreWinner.id);
  setLeaderIndex(playerIndex);
  setNextRoundLeaderIndex(playerIndex);

  return true;
}

export function resolveBlockedRound2v2(
  blockedHands: DominoTileData[][],
  _blockerIndex: number,
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

  const opponentPips = blockedHands.reduce((sum, hand, index) => {
    const player = seats[index];

    if (player.teamId === scoreWinnerTeam) {
      return sum;
    }

    return sum + getHandPipTotal(hand);
  }, 0);

  const blockScore = roundToNearestFive(opponentPips);

  if (blockScore > 0) {
    addTeamPoints(scoreWinnerTeam, blockScore, scoreWinner.id, opponentPips);
  }

  setRoundWinnerPlayerId(scoreWinner.id);
  setLeaderIndex(lowestIndex);
  setNextRoundLeaderIndex(lowestIndex);

  return true;
}

export function awardEndOfHandPoints1v1(
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
  const opponentIndex = winnerPlayerId === seats[0].id ? 1 : 0;

  const opponentPips = finalHands[opponentIndex].reduce(
    (sum, tile) => sum + tile.left + tile.right,
    0,
  );

  const endOfHandScore = roundToNearestFive(opponentPips);

  if (endOfHandScore > 0) {
    addTeamPoints(winnerTeamId, endOfHandScore, winnerPlayerId, opponentPips);
  }
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
  const opponentPips = seats.reduce((sum, player, index) => {
    if (player.teamId === winnerTeamId) {
      return sum;
    }

    return sum + getHandPipTotal(finalHands[index] ?? []);
  }, 0);

  const endOfHandScore = roundToNearestFive(opponentPips);

  if (endOfHandScore > 0) {
    addTeamPoints(winnerTeamId, endOfHandScore, winnerPlayerId, opponentPips);
  }
}

export function evaluateFinalWinner(
  scores: Record<TeamId, number>,
  setWinningTeamId: (value: TeamId | null) => void,
) {
  const winner = getFinalMatchWinner(scores);
  if (winner) setWinningTeamId(winner);
}
