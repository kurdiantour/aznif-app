import { findBestBotMove } from '@/lib/game/bot-ai';
import { getNextHandKingIndex, NEXT_HAND_OPENING_STATE } from '@/lib/game/king-rules';
import { getFinalMatchWinner } from '@/lib/game/match-rules';
import {
  applyMove,
  canAnyPlayerMove,
  canHandMove,
  createEmptyBoard,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAvailableBranches, handContainsTile } from './gameRuleQueries';
import { buildRoundResult } from './roundResult';
import { useRoundLifecycle } from './useRoundLifecycle';
import {
  createAiPracticeDeal,
  createAiPracticeSeats,
  findAiOpeningDoubleAndStarter,
} from './aiPracticeLocal';
import {
  MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN,
  getBlockedRoundWinnerIndex1v1,
  pickPreferredBranch,
  PLAYER_TURN_DURATION_SECONDS,
} from './gameShared';

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
  const [timeLeft, setTimeLeft] = useState(PLAYER_TURN_DURATION_SECONDS);
  const [humanDrawsThisTurn, setHumanDrawsThisTurn] = useState(0);
  const humanDrawsThisTurnRef = useRef(0);

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
  const [roundEndReason, setRoundEndReason] =
    useState<"blocked" | "empty_hand" | null>(null);
  const [lastScoringEvent, setLastScoringEvent] =
    useState<GameState['lastScoringEvent']>(null);

  const [teamScores, setTeamScores] = useState<Record<TeamId, number>>({
    teamA: 0,
    teamB: 0,
  });

  const [winningTeamId, setWinningTeamId] = useState<TeamId | null>(null);

  const botMoveScheduledRef = useRef(false);
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
  const boneyardHasPlayableTile = canHandMove(
    boneyard,
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
    boneyard.length > 0 &&
    boneyardHasPlayableTile &&
    humanDrawsThisTurn < MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN;

  const setHumanDrawCount = (count: number) => {
    humanDrawsThisTurnRef.current = count;
    setHumanDrawsThisTurn(count);
  };

  useEffect(() => {
    setHumanDrawCount(0);
  }, [currentIndex]);

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

  const resolveBlockedRound = (blockedHands: DominoTileData[][], blockerIndex: number) => {
    const winnerIndex = getBlockedRoundWinnerIndex1v1(blockedHands);
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
    setRoundEndReason("blocked");
    setLeaderIndex(blockerIndex);
    return true;
  };

  const startNextRound = useCallback(() => {
    if (!roundWinnerPlayerId) return;
    const nextDeal = createAiPracticeDeal(seats.length);
    const nextKingIndex = leaderIndex;
    lastTilePlayerIndexRef.current = null;
    botMoveScheduledRef.current = false;
    setBoard(createEmptyBoard());
    setHands(nextDeal.hands);
    setBoneyard(nextDeal.boneyard);
    setSpinnerValue(null);
    setIsOpeningRound(NEXT_HAND_OPENING_STATE.isOpeningRound);
    setOpeningDouble(NEXT_HAND_OPENING_STATE.openingDouble);
    setRoundWinnerPlayerId(null);
    setRoundEndReason(null);
    setLastPlayedTile(null);
    setLastPassedPlayerId(null);
    setLastScoringEvent(null);
    humanDrawsThisTurnRef.current = 0;
    setHumanDrawsThisTurn(0);
    setLeaderIndex(nextKingIndex);
    setCurrentIndex(nextKingIndex);
    setTimeLeft(PLAYER_TURN_DURATION_SECONDS);
  }, [leaderIndex, roundWinnerPlayerId, seats]);

  const createRoundResult = useCallback((winnerId: string) => {
    const winnerIndex = seats.findIndex((seat) => seat.id === winnerId);
    return buildRoundResult({
      winnerId,
      winnerTeam: winnerIndex >= 0 ? seats[winnerIndex].teamId : undefined,
      endReason: roundEndReason ?? undefined,
      awardedPoints: lastScoringEvent?.points ?? 0,
      players: seats.map((seat, playerIndex) => ({ id: seat.id, playerIndex })),
      hands,
    });
  }, [hands, lastScoringEvent?.points, roundEndReason, seats]);

  const { phase, roundResult, nextRoundCountdown } = useRoundLifecycle({
    roundWinnerPlayerId,
    winningTeamId,
    buildRoundResult: createRoundResult,
    startNextRound,
  });

  const playabilityContext = { board, spinnerValue, isOpeningRound, openingDouble };
  const availableBranchesForTile = (tile: DominoTileData) =>
    getAvailableBranches(tile, playabilityContext);

  const isRoundBlocked = useCallback((
    candidateHands: DominoTileData[][] = hands,
    candidateBoard: KozelBoardState = board,
    candidateSpinnerValue: number | null = spinnerValue,
    candidateIsOpeningRound: boolean = isOpeningRound,
    candidateOpeningDouble: number | null = openingDouble,
    candidateBoneyard: DominoTileData[] = boneyard,
  ) => {
    if (!candidateBoard.centerTile) return false;

    return (
      !canAnyPlayerMove(
        candidateHands,
        candidateBoard,
        candidateSpinnerValue,
        candidateIsOpeningRound,
        candidateOpeningDouble,
      ) &&
      !canHandMove(
        candidateBoneyard,
        candidateBoard,
        candidateSpinnerValue,
        candidateIsOpeningRound,
        candidateOpeningDouble,
      )
    );
  }, [board, boneyard, hands, isOpeningRound, openingDouble, spinnerValue]);

  const passTurnInternal = (playerIndex: number, force = false) => {
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

    if (
      !force &&
      playerIndex === 0 &&
      board.centerTile &&
      boneyard.length > 0 &&
      !playerHasPlayableTile &&
      humanDrawsThisTurnRef.current < MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN
    ) {
      return false;
    }

    showPassBadge(player.id);
    setLastScoringEvent(null);
    setCurrentIndex((playerIndex + 1) % seats.length);
    setTimeLeft(PLAYER_TURN_DURATION_SECONDS);

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
    const hasTile = handContainsTile(activeHand, tile.id);

    if (!hasTile) return false;

    const playableBranches = getAvailableBranches(tile, playabilityContext);

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
    setHumanDrawCount(0);

    lastTilePlayerIndexRef.current = playerIndex;

    if (nextHands[playerIndex].length === 0) {
      awardEndOfHandPoints(player.teamId, player.id, nextHands);
      setRoundEndReason("empty_hand");
      setRoundWinnerPlayerId(player.id);
      setLeaderIndex(playerIndex);
      return true;
    }

    if (isRoundBlocked(nextHands, nextBoard, nextSpinnerValue, false, null)) {
      resolveBlockedRound(nextHands, playerIndex);
      return true;
    }

    setCurrentIndex((playerIndex + 1) % seats.length);
    setTimeLeft(PLAYER_TURN_DURATION_SECONDS);

    return true;
  };

  const drawOneTileForPlayer = (playerIndex: number) => {
    if (roundWinnerPlayerId) return false;
    if (winningTeamId) return false;
    if (playerIndex !== currentIndex) return false;
    if (!board.centerTile) return false;
    if (boneyard.length === 0) return false;
    if (
      playerIndex === 0 &&
      humanDrawsThisTurnRef.current >= MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN
    ) {
      return false;
    }

    const hand = hands[playerIndex] ?? [];
    const playerHasPlayableTile = canHandMove(
      hand,
      board,
      spinnerValue,
      isOpeningRound,
      openingDouble,
    );

    if (playerHasPlayableTile) return false;

    if (isRoundBlocked()) {
      const blockerIndex = lastTilePlayerIndexRef.current ?? currentIndex;
      resolveBlockedRound(hands, blockerIndex);
      return false;
    }

    const drawnTile = boneyard[0];
    const nextBoneyard = boneyard.slice(1);
    const nextHand = [...hand, drawnTile];
    const nextDrawCount =
      playerIndex === 0
        ? humanDrawsThisTurnRef.current + 1
        : humanDrawsThisTurnRef.current;

    setHands((prev) =>
      prev.map((playerHand, index) =>
        index === playerIndex ? nextHand : playerHand,
      ),
    );

    setBoneyard(nextBoneyard);

    if (playerIndex === 0) {
      setHumanDrawCount(nextDrawCount);

      const stillCannotMove = !canHandMove(
        nextHand,
        board,
        spinnerValue,
        isOpeningRound,
        openingDouble,
      );

      // The drawn tile created a valid move.
       // Start a fresh full turn timer now.
      if (!stillCannotMove) {
        setTimeLeft(PLAYER_TURN_DURATION_SECONDS);
         }

      if (
        nextDrawCount >= MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN &&
        stillCannotMove
      ) {
        const player = seats[playerIndex];
        if (player) {
          showPassBadge(player.id);
        }

        setLastScoringEvent(null);
        setCurrentIndex((playerIndex + 1) % seats.length);
        setTimeLeft(PLAYER_TURN_DURATION_SECONDS);
      }
    }

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

    if (isRoundBlocked()) {
      const blockerIndex = lastTilePlayerIndexRef.current ?? currentIndex;
      resolveBlockedRound(hands, blockerIndex);
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

    if (stillCannotMove) {
      const player = seats[playerIndex];
      if (player) {
        showPassBadge(player.id);
      }

      setLastScoringEvent(null);
      setCurrentIndex((playerIndex + 1) % seats.length);
      setTimeLeft(PLAYER_TURN_DURATION_SECONDS);
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

  // Human has no playable tile and must draw.
  // Do not consume turn time while the Draw Tile prompt is active.
  if (canDrawTile) return;

  const timer = setTimeout(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (isRoundBlocked()) {
            const blockerIndex = lastTilePlayerIndexRef.current ?? currentIndex;
            resolveBlockedRound(hands, blockerIndex);
            return PLAYER_TURN_DURATION_SECONDS;
          }

          passTurnInternal(currentIndex, true);
          return PLAYER_TURN_DURATION_SECONDS;
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
  humanDrawsThisTurn,
  canDrawTile,
  isRoundBlocked,
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
      } else if (isRoundBlocked()) {
        const blockerIndex = lastTilePlayerIndexRef.current ?? currentIndex;
        resolveBlockedRound(hands, blockerIndex);
      } else if (board.centerTile && boneyard.length > 0) {
        drawUntilPlayableForBot(currentIndex);
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
    isRoundBlocked,
  ]);

  const players: Player[] = seats.map((seat, index) => ({
    ...seat,
    isActive: index === currentIndex,
    timeLeft: index === currentIndex ? timeLeft : PLAYER_TURN_DURATION_SECONDS,
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
