import { findBestBotMove } from '@/lib/game/bot-ai';
import { getNextHandKingIndex, NEXT_HAND_OPENING_STATE } from '@/lib/game/king-rules';
import { getFinalMatchWinner } from '@/lib/game/match-rules';
import {
  applyMove,
  canAnyPlayerMove,
  canHandMove,
  createEmptyBoard,
  getPlayableBranches,
  isValidMove,
  roundToNearestFive,
} from '@/lib/game/kozel-engine';
import {
  DominoTileData,
  GameState,
  KozelBoardState,
  KozelBranch,
  Player,
  TeamId,
} from '@/types/game';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createAiPracticeDeal,
  createAiPracticeSeats,
  findAiOpeningDoubleAndStarter,
} from './aiPracticeLocal';
import { pickPreferredBranch } from './gameShared';

export type AiPracticeGameState = GameState & {
  passTurn: () => boolean;
  drawTile: () => boolean;
  canDrawTile: boolean;
  hasPlayableTile: boolean;
  lastPassedPlayerId: string | null;
};

export function useAiPracticeGame(): AiPracticeGameState {
  const seats = useMemo(() => createAiPracticeSeats(), []);
  const initialDeal = useMemo(() => createAiPracticeDeal(seats.length), [seats.length]);
  const initialOpening = useMemo(
    () => findAiOpeningDoubleAndStarter(initialDeal.hands),
    [initialDeal.hands],
  );

  const [currentIndex, setCurrentIndex] = useState(initialOpening.starterIndex);
  const [leaderIndex, setLeaderIndex] = useState(initialOpening.starterIndex);
  const [timeLeft, setTimeLeft] = useState(10);

  const [board, setBoard] = useState<KozelBoardState>(() => createEmptyBoard());
  const [hands, setHands] = useState<DominoTileData[][]>(initialDeal.hands);
  const [boneyard, setBoneyard] = useState<DominoTileData[]>(initialDeal.boneyard);
  const [spinnerValue, setSpinnerValue] = useState<number | null>(null);
  const [isOpeningRound, setIsOpeningRound] = useState(true);
  const [openingDouble, setOpeningDouble] = useState<number | null>(
    initialOpening.openingDouble,
  );

  const [roundWinnerPlayerId, setRoundWinnerPlayerId] = useState<string | null>(null);
  const [lastPlayedTile, setLastPlayedTile] = useState<DominoTileData | null>(null);
  const [lastPassedPlayerId, setLastPassedPlayerId] = useState<string | null>(null);
  const [lastScoringEvent, setLastScoringEvent] =
    useState<GameState['lastScoringEvent']>(null);

  const [teamScores, setTeamScores] = useState<Record<TeamId, number>>({
    teamA: 0,
    teamB: 0,
  });

  const [winningTeamId, setWinningTeamId] = useState<TeamId | null>(null);

  const botMoveScheduledRef = useRef(false);
  const nextRoundScheduledRef = useRef(false);
  const lastTilePlayerIndexRef = useRef<number | null>(null);
  const passBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<'playing' | 'round_result_reveal' | 'next_round_countdown' | 'dealing'>('playing');
  const [roundResult, setRoundResult] = useState<
    | {
        winnerId?: string;
        winnerTeam?: TeamId;
        awardedPoints: number;
        remainingTilesByPlayer: Record<string, DominoTileData[]>;
        remainingPipsByPlayer: Record<string, number>;
      }
    | null
  >(null);
  const [nextRoundCountdown, setNextRoundCountdown] = useState<number>(5);

  const humanHand = hands[0] ?? [];

  const hasPlayableTile = canHandMove(
    humanHand,
    board,
    spinnerValue,
    isOpeningRound,
    openingDouble,
  );

  const canDrawTile =
    currentIndex === 0 &&
    !!board.centerTile &&
    !roundWinnerPlayerId &&
    !winningTeamId &&
    !hasPlayableTile &&
    boneyard.length > 0;

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

  useEffect(() => {
    if (winningTeamId) return;
    if (!roundWinnerPlayerId) return;

    const winnerTeamId = getFinalMatchWinner(teamScores);
    if (!winnerTeamId) return;

    setWinningTeamId(winnerTeamId);
  }, [roundWinnerPlayerId, teamScores, winningTeamId]);

  const addTeamPoints = (
    teamId: TeamId,
    points: number,
    playerId: string,
    openEndsTotal: number,
  ) => {
    if (points <= 0) return;

    setTeamScores((prev) => ({
      ...prev,
      [teamId]: prev[teamId] + points,
    }));

    setLastScoringEvent({ playerId, teamId, points, openEndsTotal });
  };

  const awardEndOfHandPoints = (
    winnerTeamId: TeamId,
    winnerPlayerId: string,
    finalHands: DominoTileData[][],
  ) => {
    const opponentIndex = winnerPlayerId === seats[0].id ? 1 : 0;

    const opponentPips = finalHands[opponentIndex].reduce(
      (sum, tile) => sum + tile.left + tile.right,
      0,
    );

    const endOfHandScore = roundToNearestFive(opponentPips);

    if (endOfHandScore > 0) {
      addTeamPoints(winnerTeamId, endOfHandScore, winnerPlayerId, opponentPips);
    }
  };

  const resolveBlockedRound = (blockedHands: DominoTileData[][], _blockerIndex: number) => {
    const winnerIndex = blockedHands[0].length <= blockedHands[1].length ? 0 : 1;
    const winner = seats[winnerIndex];

    const opponentPips = blockedHands[(winnerIndex + 1) % 2].reduce(
      (sum, tile) => sum + tile.left + tile.right,
      0,
    );

    const blockScore = roundToNearestFive(opponentPips);

    if (blockScore > 0) {
      addTeamPoints(winner.teamId, blockScore, winner.id, opponentPips);
    }

    setRoundWinnerPlayerId(winner.id);
    setLeaderIndex(winnerIndex);
    return true;
  };

  useEffect(() => {
    if (!roundWinnerPlayerId || winningTeamId) {
      if (!roundWinnerPlayerId) {
        nextRoundScheduledRef.current = false;
      }
      return;
    }

    if (nextRoundScheduledRef.current) return;
    nextRoundScheduledRef.current = true;

    const remainingTilesByPlayer: Record<string, DominoTileData[]> = {};
    const remainingPipsByPlayer: Record<string, number> = {};

    seats.forEach((seat, idx) => {
      const tiles = hands[idx] ?? [];
      remainingTilesByPlayer[seat.id] = tiles.map((t) => ({ ...t }));
      remainingPipsByPlayer[seat.id] = tiles.reduce((s, t) => s + t.left + t.right, 0);
    });

    const winnerIndex = seats.findIndex((p) => p.id === roundWinnerPlayerId);
    const winnerTeam = winnerIndex >= 0 ? seats[winnerIndex].teamId : undefined;
    const awardedPoints = lastScoringEvent?.points ?? 0;

    setRoundResult({
      winnerId: roundWinnerPlayerId ?? undefined,
      winnerTeam,
      awardedPoints,
      remainingTilesByPlayer,
      remainingPipsByPlayer,
    });

    setPhase('round_result_reveal');

    phaseTimerRef.current = setTimeout(() => {
      setPhase('next_round_countdown');
      setNextRoundCountdown(5);

      countdownIntervalRef.current = setInterval(() => {
        setNextRoundCountdown((prev) => {
          if (prev <= 1) {
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
            }

            const nextDeal = createAiPracticeDeal(seats.length);
            const nextKingIndex = getNextHandKingIndex(seats, roundWinnerPlayerId);

            lastTilePlayerIndexRef.current = null;
            botMoveScheduledRef.current = false;

            setBoard(createEmptyBoard());
            setHands(nextDeal.hands);
            setBoneyard(nextDeal.boneyard);
            setSpinnerValue(null);
            setIsOpeningRound(NEXT_HAND_OPENING_STATE.isOpeningRound);
            setOpeningDouble(NEXT_HAND_OPENING_STATE.openingDouble);

            setRoundWinnerPlayerId(null);
            setLastPlayedTile(null);
            setLastPassedPlayerId(null);
            setLastScoringEvent(null);

            setLeaderIndex(nextKingIndex);
            setCurrentIndex(nextKingIndex);
            setTimeLeft(10);

            nextRoundScheduledRef.current = false;
            setRoundResult(null);
            setPhase('playing');

            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, 5000);

    return () => {
      if (phaseTimerRef.current) {
        clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [roundWinnerPlayerId, winningTeamId, seats, hands, lastScoringEvent]);

  const availableBranchesForTile = (tile: DominoTileData) => {
    return getPlayableBranches(
      tile,
      board,
      spinnerValue,
      isOpeningRound,
      openingDouble,
    );
  };

  const passTurnInternal = (playerIndex: number) => {
    if (roundWinnerPlayerId) return false;
    if (winningTeamId) return false;
    if (playerIndex !== currentIndex) return false;

    const player = seats[playerIndex];
    if (!player) return false;

    const hand = hands[playerIndex] ?? [];
    const playerHasPlayableTile = canHandMove(
      hand,
      board,
      spinnerValue,
      isOpeningRound,
      openingDouble,
    );

    if (playerIndex === 0 && board.centerTile && boneyard.length > 0 && !playerHasPlayableTile) {
      return false;
    }

    showPassBadge(player.id);
    setLastScoringEvent(null);
    setCurrentIndex((playerIndex + 1) % seats.length);
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
        : pickPreferredBranch(playableBranches, ['right', 'left', 'up', 'down']);

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

    const {
      board: nextBoard,
      spinnerValue: nextSpinnerValue,
      moveScore,
    } = applyMove(board, tile, branch, spinnerValue, isOpeningRound);

    const nextHands = hands.map((hand, index) =>
      index === playerIndex
        ? hand.filter((handTile) => handTile.id !== tile.id)
        : hand,
    );

    const player = seats[playerIndex];

    if (moveScore > 0) {
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
      awardEndOfHandPoints(player.teamId, player.id, nextHands);
      setRoundWinnerPlayerId(player.id);
      setLeaderIndex(playerIndex);
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

  const drawOneTileForPlayer = (playerIndex: number) => {
    if (roundWinnerPlayerId) return false;
    if (winningTeamId) return false;
    if (playerIndex !== currentIndex) return false;
    if (!board.centerTile) return false;
    if (boneyard.length === 0) return false;

    const hand = hands[playerIndex] ?? [];
    const playerHasPlayableTile = canHandMove(
      hand,
      board,
      spinnerValue,
      isOpeningRound,
      openingDouble,
    );

    if (playerHasPlayableTile) return false;

    const drawnTile = boneyard[0];
    const nextBoneyard = boneyard.slice(1);

    setHands((prev) =>
      prev.map((playerHand, index) =>
        index === playerIndex ? [...playerHand, drawnTile] : playerHand,
      ),
    );

    setBoneyard(nextBoneyard);
    setTimeLeft(10);

    return true;
  };

  const drawUntilPlayableForBot = (playerIndex: number) => {
    if (roundWinnerPlayerId) return false;
    if (winningTeamId) return false;
    if (playerIndex !== currentIndex) return false;
    if (!board.centerTile) return false;
    if (boneyard.length === 0) return false;

    const currentHand = hands[playerIndex] ?? [];

    if (canHandMove(currentHand, board, spinnerValue, isOpeningRound, openingDouble)) {
      return false;
    }

    const nextHand = [...currentHand];
    const nextBoneyard = [...boneyard];

    let drawCount = 0;

    while (
      drawCount < 3 &&
      nextBoneyard.length > 0 &&
      !canHandMove(nextHand, board, spinnerValue, isOpeningRound, openingDouble)
    ) {
      const drawnTile = nextBoneyard.shift();
      if (!drawnTile) break;

      nextHand.push(drawnTile);
      drawCount += 1;
    }

    const stillCannotMove = !canHandMove(
      nextHand,
      board,
      spinnerValue,
      isOpeningRound,
      openingDouble,
    );

    setHands((prev) =>
      prev.map((playerHand, index) =>
        index === playerIndex ? nextHand : playerHand,
      ),
    );

    setBoneyard(nextBoneyard);
    setTimeLeft(10);

    if (stillCannotMove) {
      const player = seats[playerIndex];
      if (player) {
        showPassBadge(player.id);
      }

      setLastScoringEvent(null);
      setCurrentIndex((playerIndex + 1) % seats.length);
    }

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
          const activeHand = hands[currentIndex] ?? [];

          if (
            currentIndex === 0 &&
            board.centerTile &&
            boneyard.length > 0 &&
            !canHandMove(activeHand, board, spinnerValue, isOpeningRound, openingDouble)
          ) {
            return 10;
          }

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
  ]);

  useEffect(() => {
    if (roundWinnerPlayerId) return;
    if (winningTeamId) return;

    const activeSeat = seats[currentIndex];

    if (!activeSeat || activeSeat.kind !== 'bot') {
      botMoveScheduledRef.current = false;
      return;
    }

    if (botMoveScheduledRef.current) return;

    botMoveScheduledRef.current = true;

    const botTimer = setTimeout(() => {
      const botHand = hands[currentIndex] ?? [];

      const botMove = findBestBotMove(
        botHand,
        board,
        spinnerValue,
        isOpeningRound,
        openingDouble,
      );

      if (botMove) {
        playTileForPlayer(botMove.tile, currentIndex, botMove.branch);
      } else if (board.centerTile && boneyard.length > 0) {
        drawUntilPlayableForBot(currentIndex);
      } else if (
        board.centerTile &&
        !canAnyPlayerMove(hands, board, spinnerValue, isOpeningRound, openingDouble) &&
        boneyard.length === 0
      ) {
        const blockerIndex = lastTilePlayerIndexRef.current ?? currentIndex;
        resolveBlockedRound(hands, blockerIndex);
      } else {
        passTurnInternal(currentIndex);
      }

      botMoveScheduledRef.current = false;
    }, 700);

    return () => {
      clearTimeout(botTimer);
      botMoveScheduledRef.current = false;
    };
  }, [
    board,
    currentIndex,
    hands,
    boneyard,
    roundWinnerPlayerId,
    winningTeamId,
    seats,
    spinnerValue,
    isOpeningRound,
    openingDouble,
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
    boneyardCount: boneyard.length,
    mode: '1v1',
    roundWinnerPlayerId,
    lastPlayedTile,
    lastScoringEvent,
    teamScores,
    winningTeamId,
    leaderPlayerId: players[leaderIndex]?.id ?? 'p1',
    isFirstRound: isOpeningRound,
    availableBranchesForTile,
    playTile,
    passTurn,
    drawTile,
    canDrawTile,
    hasPlayableTile,
    lastPassedPlayerId,
    phase,
    roundResult,
    nextRoundCountdown,
  };
}