import { FULL_DOMINO_SET } from '@/constants/domino-set';
import { dealDominoHands } from '@/lib/domino/deal';
import { shuffleArray } from '@/lib/domino/shuffle';
import {
  applyMove,
  canAnyPlayerMove,
  canHandMove,
  createEmptyBoard,
  getPlayableBranches,
  isValidMove,
} from '@/lib/game/kozel-engine';
import {
  DominoTileData,
  GameMode,
  GameState,
  KozelBoardState,
  KozelBranch,
  MatchReward,
  Player,
  TeamId,
} from '@/types/game';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateMatchReward,
  getInitialDeal,
  pickPreferredBranch,
  SeatDefinition,
} from './gameShared';

export type MockGameState = GameState & {
  passTurn: () => boolean;
  drawTile: () => boolean;
  canDrawTile: boolean;
  hasPlayableTile: boolean;
  lastPassedPlayerId: string | null;
};

type ResolveBlockedRoundFn = (...args: any[]) => boolean;

type AwardEndOfHandPointsFn = (
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
) => void;

type CanDrawTileFn = (
  playerIndex: number,
  currentIndex: number,
  board: KozelBoardState,
  roundWinnerPlayerId: string | null,
  winningTeamId: TeamId | null,
  hasPlayableTile: boolean,
  boneyardLength: number,
) => boolean;

type ShouldRefusePassFn = (
  playerIndex: number,
  board: KozelBoardState,
  boneyardLength: number,
  hasPlayableTile: boolean,
) => boolean;

type GameConfig = {
  mode: GameMode;
  seats: SeatDefinition[];
  canDrawTile: CanDrawTileFn;
  shouldRefusePassBecauseDrawAvailable: ShouldRefusePassFn;
  resolveBlockedRound: ResolveBlockedRoundFn;
  awardEndOfHandPoints: AwardEndOfHandPointsFn;
  scoringEnabled: boolean;
};

function findOpeningDoubleAndStarter(hands: DominoTileData[][]) {
  for (let doubleValue = 6; doubleValue >= 0; doubleValue -= 1) {
    for (let i = 0; i < hands.length; i += 1) {
      const found = hands[i]?.some(
        (tile) => tile.left === doubleValue && tile.right === doubleValue,
      );

      if (found) {
        return {
          starterIndex: i,
          openingDouble: doubleValue,
        };
      }
    }
  }

  return {
    starterIndex: -1,
    openingDouble: null as number | null,
  };
}

export function useGameBase(config: GameConfig): MockGameState {
  const seats = config.seats;
  const initialDeal = useMemo(() => getInitialDeal(seats.length), [seats.length]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [leaderIndex, setLeaderIndex] = useState(0);
  const [nextRoundLeaderIndex, setNextRoundLeaderIndex] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(30);

  const [board, setBoard] = useState<KozelBoardState>(() => createEmptyBoard());
  const [hands, setHands] = useState<DominoTileData[][]>(initialDeal.hands);
  const [boneyard, setBoneyard] = useState<DominoTileData[]>(initialDeal.boneyard);
  const [boneyardCount, setBoneyardCount] = useState(initialDeal.boneyard.length);

  const [spinnerValue, setSpinnerValue] = useState<number | null>(null);
  const [isOpeningRound, setIsOpeningRound] = useState(true);
  const [openingDouble, setOpeningDouble] = useState<number | null>(() => {
    return findOpeningDoubleAndStarter(initialDeal.hands).openingDouble;
  });

  const [roundWinnerPlayerId, setRoundWinnerPlayerId] = useState<string | null>(null);
  const [lastPlayedTile, setLastPlayedTile] = useState<DominoTileData | null>(null);
  const [lastPassedPlayerId, setLastPassedPlayerId] = useState<string | null>(null);
  const [lastScoringEvent, setLastScoringEvent] =
    useState<GameState['lastScoringEvent']>(null);

  const [teamScores, setTeamScores] = useState<Record<TeamId, number>>({
    teamA: 0,
    teamB: 0,
  });

  const teamScoresRef = useRef<Record<TeamId, number>>({
    teamA: 0,
    teamB: 0,
  });

  const [winningTeamId, setWinningTeamId] = useState<TeamId | null>(null);
  const [matchReward, setMatchReward] = useState<MatchReward | null>(null);

  const hasStartedRef = useRef(false);
  const nextRoundScheduledRef = useRef(false);
  const lastTilePlayerIndexRef = useRef<number | null>(null);
  const passBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const humanHand = hands[0] ?? [];

  const hasPlayableTile = canHandMove(
    humanHand,
    board,
    spinnerValue,
    isOpeningRound,
    openingDouble,
  );

  const canDrawTile = config.canDrawTile(
    0,
    currentIndex,
    board,
    roundWinnerPlayerId,
    winningTeamId,
    hasPlayableTile,
    boneyard.length,
  );

  useEffect(() => {
    return () => {
      if (passBadgeTimerRef.current) {
        clearTimeout(passBadgeTimerRef.current);
      }
    };
  }, []);

  const showPassBadge = (playerId: string) => {
    if (passBadgeTimerRef.current) {
      clearTimeout(passBadgeTimerRef.current);
    }

    setLastPassedPlayerId(playerId);

    passBadgeTimerRef.current = setTimeout(() => {
      setLastPassedPlayerId(null);
      passBadgeTimerRef.current = null;
    }, 3000);
  };

  const updateTeamScores = (
    updater: (prev: Record<TeamId, number>) => Record<TeamId, number>,
  ) => {
    setTeamScores((prev) => {
      const next = updater(prev);
      teamScoresRef.current = next;
      return next;
    });
  };

  const addTeamPoints = (
    teamId: TeamId,
    points: number,
    playerId: string,
    openEndsTotal: number,
  ) => {
    if (!config.scoringEnabled || points <= 0) return;

    updateTeamScores((prev) => ({
      ...prev,
      [teamId]: prev[teamId] + points,
    }));

    setLastScoringEvent({ playerId, teamId, points, openEndsTotal });
  };

  const evaluateFinalWinnerAfterHand = (scores: Record<TeamId, number>) => {
    if (!config.scoringEnabled) return;
    if (winningTeamId) return;

    const teamAReachedTarget = scores.teamA >= 350;
    const teamBReachedTarget = scores.teamB >= 350;

    if (!teamAReachedTarget && !teamBReachedTarget) return;

    if (scores.teamA > scores.teamB) {
      setWinningTeamId('teamA');
      setMatchReward(calculateMatchReward(scores.teamA, scores.teamB));
      return;
    }

    if (scores.teamB > scores.teamA) {
      setWinningTeamId('teamB');
      setMatchReward(calculateMatchReward(scores.teamB, scores.teamA));
    }
  };

  const resolveBlockedRound = (blockedHands: DominoTileData[][], blockerIndex: number) => {
    return config.resolveBlockedRound(
      blockedHands,
      blockerIndex,
      seats,
      teamScoresRef,
      addTeamPoints,
      setRoundWinnerPlayerId,
      setLeaderIndex,
      setNextRoundLeaderIndex,
    );
  };

  const awardEndOfHandPoints = (
    winnerTeamIdArg: TeamId,
    winnerPlayerId: string,
    finalHands: DominoTileData[][],
  ) => {
    if (!config.scoringEnabled) return;

    config.awardEndOfHandPoints(
      winnerTeamIdArg,
      winnerPlayerId,
      finalHands,
      seats,
      addTeamPoints,
    );
  };

  const drawOneTileForPlayer = (playerIndex: number) => {
    if (roundWinnerPlayerId) return false;
    if (winningTeamId) return false;
    if (playerIndex !== currentIndex) return false;
    if (boneyard.length === 0) return false;

    const hand = hands[playerIndex] ?? [];
    const playerHasPlayableTile = canHandMove(
      hand,
      board,
      spinnerValue,
      isOpeningRound,
      openingDouble,
    );

    const playerCanDraw = config.canDrawTile(
      playerIndex,
      currentIndex,
      board,
      roundWinnerPlayerId,
      winningTeamId,
      playerHasPlayableTile,
      boneyard.length,
    );

    if (!playerCanDraw) return false;

    const drawnTile = boneyard[0];
    const nextBoneyard = boneyard.slice(1);

    setHands((prev) =>
      prev.map((handItem, index) =>
        index === playerIndex ? [...handItem, drawnTile] : handItem,
      ),
    );

    setBoneyard(nextBoneyard);
    setBoneyardCount(nextBoneyard.length);
    setTimeLeft(10);

    return true;
  };

  useEffect(() => {
    if (hasStartedRef.current) return;

    const opening = findOpeningDoubleAndStarter(hands);

    if (opening.starterIndex === -1 || opening.openingDouble === null) {
      return;
    }

    hasStartedRef.current = true;
    lastTilePlayerIndexRef.current = null;

    setBoard(createEmptyBoard());
    setSpinnerValue(null);
    setIsOpeningRound(true);
    setOpeningDouble(opening.openingDouble);

    setLeaderIndex(opening.starterIndex);
    setNextRoundLeaderIndex(opening.starterIndex);
    setLastPlayedTile(null);
    setLastPassedPlayerId(null);
    setLastScoringEvent(null);

    setCurrentIndex(opening.starterIndex);
    setTimeLeft(10);
  }, [hands]);

  useEffect(() => {
    if (!roundWinnerPlayerId) return;
    if (winningTeamId) return;

    evaluateFinalWinnerAfterHand(teamScores);
  }, [roundWinnerPlayerId, teamScores, winningTeamId]);

  useEffect(() => {
    if (!roundWinnerPlayerId || winningTeamId) {
      if (!roundWinnerPlayerId) {
        nextRoundScheduledRef.current = false;
      }
      return;
    }

    if (nextRoundScheduledRef.current) return;
    nextRoundScheduledRef.current = true;

    const timer = setTimeout(() => {
      const winnerIndex = seats.findIndex((player) => player.id === roundWinnerPlayerId);

      const starterIndex =
        nextRoundLeaderIndex ?? (winnerIndex === -1 ? 0 : winnerIndex);

      const nextDeal = dealDominoHands(shuffleArray(FULL_DOMINO_SET), seats.length);
      const opening = findOpeningDoubleAndStarter(nextDeal.hands);
      const nextStarterIndex =
        opening.starterIndex === -1 ? starterIndex : opening.starterIndex;

      hasStartedRef.current = false;
      lastTilePlayerIndexRef.current = null;

      setBoard(createEmptyBoard());
      setHands(nextDeal.hands);
      setBoneyard(nextDeal.boneyard);
      setBoneyardCount(nextDeal.boneyard.length);

      setSpinnerValue(null);
      setIsOpeningRound(true);
      setOpeningDouble(opening.openingDouble);

      setRoundWinnerPlayerId(null);
      setNextRoundLeaderIndex(nextStarterIndex);
      setLastPlayedTile(null);
      setLastPassedPlayerId(null);
      setLastScoringEvent(null);

      setLeaderIndex(nextStarterIndex);
      setCurrentIndex(nextStarterIndex);
      setTimeLeft(10);

      nextRoundScheduledRef.current = false;
    }, 5000);

    return () => clearTimeout(timer);
  }, [roundWinnerPlayerId, nextRoundLeaderIndex, seats, winningTeamId]);

  const availableBranchesForTile = (tile: DominoTileData) => {
    return getPlayableBranches(
      tile,
      board,
      spinnerValue,
      isOpeningRound,
      openingDouble,
    );
  };

  const passTurnInternal = (playerIndex?: number) => {
    if (roundWinnerPlayerId) return false;
    if (winningTeamId) return false;

    const actualIndex = playerIndex ?? currentIndex;
    const player = seats[actualIndex];

    if (!player) return false;

    const hand = hands[actualIndex] ?? [];
    const playerHasPlayableTile = canHandMove(
      hand,
      board,
      spinnerValue,
      isOpeningRound,
      openingDouble,
    );

    if (
      config.shouldRefusePassBecauseDrawAvailable(
        actualIndex,
        board,
        boneyard.length,
        playerHasPlayableTile,
      )
    ) {
      return false;
    }

    showPassBadge(player.id);
    setLastScoringEvent(null);
    setCurrentIndex((actualIndex + 1) % seats.length);
    setTimeLeft(10);

    return true;
  };

  const playTileForPlayer = (
    tile: DominoTileData,
    playerIndex: number,
    preferredBranch?: KozelBranch,
  ) => {
    if (roundWinnerPlayerId) return false;
    if (winningTeamId) return false;
    if (playerIndex !== currentIndex) return false;

    const activeHand = hands[playerIndex] ?? [];
    const hasTile = activeHand.some((handTile) => handTile.id === tile.id);

    if (!hasTile) return false;

    const playableBranches = getPlayableBranches(
      tile,
      board,
      spinnerValue,
      isOpeningRound,
      openingDouble,
    );

    if (!playableBranches.length) return false;

    const branch =
      preferredBranch && playableBranches.includes(preferredBranch)
        ? preferredBranch
        : pickPreferredBranch(
            playableBranches,
            config.mode === '1v1'
              ? ['right', 'left', 'up', 'down']
              : ['up', 'down', 'left', 'right'],
          );

    if (
      !isValidMove(
        tile,
        board,
        branch,
        spinnerValue,
        isOpeningRound,
        openingDouble,
      )
    ) {
      return false;
    }

    const { board: nextBoard, spinnerValue: nextSpinnerValue, moveScore } =
      applyMove(board, tile, branch, spinnerValue, isOpeningRound);

    const nextHands = hands.map((hand, index) =>
      index === playerIndex
        ? hand.filter((handTile) => handTile.id !== tile.id)
        : hand,
    );

    const player = seats[playerIndex];

    if (moveScore > 0 && config.scoringEnabled) {
      addTeamPoints(player.teamId, moveScore, player.id, moveScore);
    } else {
      setLastScoringEvent(null);
    }

    setBoard(nextBoard);
    setHands(nextHands);
    setSpinnerValue(nextSpinnerValue);
    setIsOpeningRound(false);
    setOpeningDouble(null);
    setLastPlayedTile(tile);
    setLastPassedPlayerId(null);

    lastTilePlayerIndexRef.current = playerIndex;

    if (nextHands[playerIndex].length === 0) {
      if (config.scoringEnabled) {
        awardEndOfHandPoints(player.teamId, player.id, nextHands);
      }

      setRoundWinnerPlayerId(player.id);
      setLeaderIndex(playerIndex);
      setNextRoundLeaderIndex(playerIndex);
      return true;
    }

    const blocked =
      !canAnyPlayerMove(nextHands, nextBoard, nextSpinnerValue, false, null) &&
      boneyard.length === 0;

    if (blocked) {
      resolveBlockedRound(nextHands, playerIndex);
      return true;
    }

    setCurrentIndex((playerIndex + 1) % seats.length);
    setTimeLeft(10);

    return true;
  };

  const playTile = (tile: DominoTileData, branch?: KozelBranch) => {
    return playTileForPlayer(tile, 0, branch);
  };

  const drawTile = () => {
    return drawOneTileForPlayer(0);
  };

  const passTurn = () => {
    return passTurnInternal(0);
  };

  useEffect(() => {
    if (roundWinnerPlayerId) return;
    if (winningTeamId) return;

    const timer = setTimeout(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (
            board.centerTile &&
            !canAnyPlayerMove(hands, board, spinnerValue, isOpeningRound, openingDouble) &&
            boneyard.length === 0
          ) {
            const blockerIndex = lastTilePlayerIndexRef.current ?? currentIndex;
            resolveBlockedRound(hands, blockerIndex);
            return 10;
          }

          passTurnInternal(currentIndex);
          return 10;
        }

        return prev - 1;
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    timeLeft,
    roundWinnerPlayerId,
    winningTeamId,
    board,
    hands,
    boneyard,
    spinnerValue,
    isOpeningRound,
    openingDouble,
    currentIndex,
    seats,
    config,
  ]);

  const players: Player[] = seats.map((seat, index) => ({
    ...seat,
    isActive: index === currentIndex,
    timeLeft: index === currentIndex ? timeLeft : 10,
    tileCount: hands[index]?.length ?? 0,
    score: teamScores[seat.teamId] ?? 0,
    isLeader: index === leaderIndex,
  }));

  return {
    players,
    currentTurnPlayerId: players[currentIndex]?.id ?? 'p1',
    board,
    myHand: hands[0] ?? [],
    boneyardCount,
    mode: config.mode,
    roundWinnerPlayerId,
    lastPlayedTile,
    lastScoringEvent,
    teamScores,
    winningTeamId,
    matchReward,
    leaderPlayerId: players[leaderIndex]?.id ?? 'p1',
    isFirstRound: isOpeningRound,
    availableBranchesForTile,
    playTile,
    passTurn,
    drawTile,
    canDrawTile,
    hasPlayableTile,
    lastPassedPlayerId,
  };
}