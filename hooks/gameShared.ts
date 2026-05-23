import type { AvatarId } from '@/constants/avatars';
import { FULL_DOMINO_SET } from '@/constants/domino-set';
import { dealDominoHands } from '@/lib/domino/deal';
import { shuffleArray } from '@/lib/domino/shuffle';
import { findBestBotMove } from '@/lib/game/bot-ai';
import {
    applyMove,
    getHandPipTotal,
    getPlayableBranches,
    isValidMove,
    roundToNearestFive,
} from '@/lib/game/kozel-engine';
import {
    DominoTileData,
    KozelBoardState,
    KozelBranch,
    MatchPerformanceTier,
    MatchReward,
    Player,
    TeamId,
} from '@/types/game';
import { MutableRefObject } from 'react';

const MATCH_REWARD_RULES: Array<{
  tier: MatchPerformanceTier;
  maxDifference: number;
  gold: number;
  points: number;
}> = [
  { tier: 'close', maxDifference: 50, gold: 3, points: 10 },
  { tier: 'normal', maxDifference: 150, gold: 6, points: 20 },
  { tier: 'dominating', maxDifference: Number.POSITIVE_INFINITY, gold: 9, points: 30 },
];

export function calculateMatchReward(
  winnerScore: number,
  loserScore: number,
): MatchReward {
  const difference = Math.max(0, winnerScore - loserScore);
  const rule = MATCH_REWARD_RULES.find((item) => difference <= item.maxDifference) ?? MATCH_REWARD_RULES[2];

  return {
    tier: rule.tier,
    gold: rule.gold,
    points: rule.points,
  };
}

export type SeatDefinition = {
  id: string;
  name: string;
  avatarId: AvatarId;
  seat: Player['seat'];
  kind: Player['kind'];
  teamId: TeamId;
};

export type BotMoveDecision = {
  tile: DominoTileData;
  branch: KozelBranch;
  score: number;
};

const BOT_BRANCH_PRIORITY_1V1: KozelBranch[] = ['right', 'left', 'up', 'down'];
const BOT_BRANCH_PRIORITY_2V2: KozelBranch[] = ['up', 'down', 'left', 'right'];

export function createOneVsOneSeats(): SeatDefinition[] {
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
      id: 'p3',
      name: 'AI Bot',
      avatarId: 'bot-avatar',
      seat: 'top',
      kind: 'bot',
      teamId: 'teamB',
    },
  ];
}

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

export function findTwoVsTwoBotMove(
  hand: DominoTileData[],
  board: KozelBoardState,
  spinnerValue: number | null,
  isOpeningRound: boolean,
) {
  const moves: BotMoveDecision[] = [];

  for (const tile of hand) {
    const playableBranches = getPlayableBranches(
      tile,
      board,
      spinnerValue,
      isOpeningRound,
    );

    for (const branch of playableBranches) {
      if (!isValidMove(tile, board, branch, spinnerValue, isOpeningRound)) {
        continue;
      }

      const { moveScore } = applyMove(
        board,
        tile,
        branch,
        spinnerValue,
        isOpeningRound,
      );

      moves.push({ tile, branch, score: moveScore });
    }
  }

  if (!moves.length) {
    return null;
  }

  const bestScore = Math.max(...moves.map((move) => move.score));
  const candidateMoves = moves.filter((move) => move.score === bestScore);

  const preferredBranch = pickPreferredBranch(
    candidateMoves.map((move) => move.branch),
    BOT_BRANCH_PRIORITY_2V2,
  );

  return candidateMoves.find((move) => move.branch === preferredBranch) ?? candidateMoves[0];
}

export function getBotMoveFor1v1(
  hand: DominoTileData[],
  board: KozelBoardState,
  spinnerValue: number | null,
  isOpeningRound: boolean,
) {
  return findBestBotMove(hand, board, spinnerValue, isOpeningRound);
}

export function getBotMoveFor2v2(
  hand: DominoTileData[],
  board: KozelBoardState,
  spinnerValue: number | null,
  isOpeningRound: boolean,
) {
  return findTwoVsTwoBotMove(hand, board, spinnerValue, isOpeningRound);
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
  blockerIndex: number,
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
  const playerIndex = blockedHands[0].length <= blockedHands[1].length ? 0 : 1;
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
  setLeaderIndex(blockerIndex);
  setNextRoundLeaderIndex(blockerIndex);

  return true;
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
  setLeaderIndex(blockerIndex);
  setNextRoundLeaderIndex(blockerIndex);

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
  const teamAScore = scores.teamA;
  const teamBScore = scores.teamB;

  if (teamAScore >= 350 || teamBScore >= 350) {
    if (teamAScore > teamBScore) {
      setWinningTeamId('teamA');
    } else if (teamBScore > teamAScore) {
      setWinningTeamId('teamB');
    }
  }
}
