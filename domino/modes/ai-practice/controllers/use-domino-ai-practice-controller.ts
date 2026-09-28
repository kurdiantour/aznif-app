import { getNextHandKingIndex, NEXT_HAND_OPENING_STATE } from '@/domino/core/rules/king-rules';
import {
  applyMove,
  canAnyPlayerMove,
  canHandMove,
  createEmptyBoard,
  isValidMove,
  roundToNearestFive,
} from '@/domino/core/engine/kozel-engine';
import {
  DominoTileData,
  GameState,
  KozelBoardState,
  KozelBranch,
  Player,
  TeamId,
} from '@/domino/types/domino-game';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAvailableBranches, handContainsTile } from '@/domino/shared/rules/game-rule-queries';
import { buildRoundResult } from '@/domino/shared/lifecycle/round-result';
import { useRoundLifecycle } from '@/domino/shared/lifecycle/use-round-lifecycle';
import { decideAiPracticeBotTurn, scheduleAiPracticeBotTurn } from './ai-practice-bot-controller';
import { createAiPracticeNextRound } from '../lifecycle/ai-practice-lifecycle';
import { useAiPracticeTurnLifecycle } from '../lifecycle/use-ai-practice-turn-lifecycle';
import { reduceAiPracticeBlocked, reduceAiPracticeBotDraw, reduceAiPracticeHumanDraw, reduceAiPracticePass, reduceAiPracticePlay, type AiPracticeAuthoritativeState, type AiPracticeTransition } from '../authoritative/ai-practice-command-reducer';
import {
  createAiPracticeDeal,
  createAiPracticeSeats,
  findAiOpeningDoubleAndStarter,
} from '../engine/ai-practice-engine';
import {
  MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN,
  getBlockedRoundWinnerIndex1v1,
  pickPreferredBranch,
  PLAYER_TURN_DURATION_SECONDS,
} from '@/domino/shared/game-shared';

export type AiPracticeGameState = GameState & {
  passTurn: () => boolean;
  drawTile: () => boolean;
  canDrawTile: boolean;
  hasPlayableTile: boolean;
  lastPassedPlayerId: string | null;
};

export function useAiPracticeGame(humanUserId: string | null): AiPracticeGameState {
  // The screen mounts a fresh game per account; null disables this hook in other modes.
  const seats = useMemo(() => humanUserId ? createAiPracticeSeats(humanUserId) : [], [humanUserId]);
  const initialDeal = useMemo(() => createAiPracticeDeal(2), []);
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
    !!humanUserId &&
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

  const startNextRound = useCallback(() => {
    if (!roundWinnerPlayerId) return;
    const next = createAiPracticeNextRound({
      seatCount: seats.length,
      leaderIndex,
    });
    lastTilePlayerIndexRef.current = null;
    botMoveScheduledRef.current = false;
    setBoard(next.board);
    setHands(next.hands);
    setBoneyard(next.boneyard);
    setSpinnerValue(next.spinnerValue);
    setIsOpeningRound(next.isOpeningRound);
    setOpeningDouble(next.openingDouble);
    setRoundWinnerPlayerId(next.roundWinnerPlayerId);
    setRoundEndReason(next.roundEndReason);
    setLastPlayedTile(next.lastPlayedTile);
    setLastPassedPlayerId(next.lastPassedPlayerId);
    setLastScoringEvent(next.lastScoringEvent);
    humanDrawsThisTurnRef.current = next.humanDrawsThisTurn;
    setHumanDrawsThisTurn(next.humanDrawsThisTurn);
    setLeaderIndex(next.leaderIndex);
    setCurrentIndex(next.currentIndex);
    setTimeLeft(next.timeLeft);
  }, [leaderIndex, roundWinnerPlayerId, seats.length]);
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

  const { phase, roundResult, completedFinalRevealKey, nextRoundCountdown } = useRoundLifecycle({
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

  const authoritativeState = (): AiPracticeAuthoritativeState => ({
    seats,
    currentIndex,
    leaderIndex,
    board,
    hands,
    boneyard,
    spinnerValue,
    isOpeningRound,
    openingDouble,
    roundWinnerPlayerId,
    winningTeamId,
    teamScores,
    humanDrawsThisTurn: humanDrawsThisTurnRef.current,
    lastTilePlayerIndex: lastTilePlayerIndexRef.current,
  });

  const applyAuthoritativeTransition = (transition: AiPracticeTransition) => {
    if (!humanUserId) return false;
    if (!transition.accepted) return false;
    const next = transition.state;
    setBoard(next.board);
    setHands(next.hands);
    setBoneyard(next.boneyard);
    setSpinnerValue(next.spinnerValue);
    setIsOpeningRound(next.isOpeningRound);
    setOpeningDouble(next.openingDouble);
    setCurrentIndex(next.currentIndex);
    setLeaderIndex(next.leaderIndex);
    setRoundWinnerPlayerId(next.roundWinnerPlayerId);
    setWinningTeamId(next.winningTeamId as TeamId | null);
    setTeamScores(next.teamScores as Record<TeamId, number>);
    setHumanDrawCount(next.humanDrawsThisTurn);
    lastTilePlayerIndexRef.current = next.lastTilePlayerIndex;
    if (transition.lastPlayedTile !== undefined) {
      setLastPlayedTile(transition.lastPlayedTile);
    }
    if (transition.lastPassedPlayerId) {
      showPassBadge(transition.lastPassedPlayerId);
    } else if (transition.lastPassedPlayerId === null) {
      setLastPassedPlayerId(null);
    }
    if (transition.roundEndReason !== undefined) {
      setRoundEndReason(transition.roundEndReason);
    }
    setLastScoringEvent(
      transition.scoringEvents.length
        ? transition.scoringEvents[transition.scoringEvents.length - 1] as GameState['lastScoringEvent']
        : null,
    );
    if (!next.roundWinnerPlayerId && !next.winningTeamId) {
      setTimeLeft(PLAYER_TURN_DURATION_SECONDS);
    }
    return true;
  };

  const passTurnInternal = (playerIndex: number, force = false) =>
    !!humanUserId && applyAuthoritativeTransition(
      reduceAiPracticePass(authoritativeState(), playerIndex, force),
    );

  const playTileForPlayer = (
    tile: DominoTileData,
    playerIndex: number,
    preferredBranch?: KozelBranch,
  ) => !!humanUserId && applyAuthoritativeTransition(
    reduceAiPracticePlay(authoritativeState(), tile, playerIndex, preferredBranch),
  );
  const drawOneTileForPlayer = (playerIndex: number) =>
    !!humanUserId && applyAuthoritativeTransition(
      reduceAiPracticeHumanDraw(authoritativeState(), playerIndex),
    );

  const drawUntilPlayableForBot = (playerIndex: number) =>
    !!humanUserId && applyAuthoritativeTransition(
      reduceAiPracticeBotDraw(authoritativeState(), playerIndex),
    );
  const playTile = (tile: DominoTileData, branch?: KozelBranch) => {
    return playTileForPlayer(tile, 0, branch);
  };

  const drawTile = () => {
    return drawOneTileForPlayer(0);
  };

  const passTurn = () => {
    return passTurnInternal(0);
  };

  useAiPracticeTurnLifecycle({
    timeLeft,
    terminal: !humanUserId || Boolean(roundWinnerPlayerId || winningTeamId),
    pausedForDraw: canDrawTile,
    durationSeconds: PLAYER_TURN_DURATION_SECONDS,
    setTimeLeft,
    onExpired: () => {
      if (isRoundBlocked()) {
        const blockerIndex = lastTilePlayerIndexRef.current ?? currentIndex;
        applyAuthoritativeTransition(
          reduceAiPracticeBlocked(authoritativeState(), blockerIndex),
        );
        return;
      }
      passTurnInternal(currentIndex, true);
    },
  });
  useEffect(() => {
    if (roundWinnerPlayerId || winningTeamId) return;
    const activeSeat = seats[currentIndex];
    if (!activeSeat || activeSeat.kind !== 'bot') {
      botMoveScheduledRef.current = false;
      return;
    }
    if (botMoveScheduledRef.current) return;
    botMoveScheduledRef.current = true;

    return scheduleAiPracticeBotTurn(() => {
      const decision = decideAiPracticeBotTurn({
        hand: hands[currentIndex] ?? [],
        board,
        spinnerValue,
        isOpeningRound,
        openingDouble,
        roundBlocked: isRoundBlocked(),
        boneyardCount: boneyard.length,
      });
      if (decision.type === 'play') {
        playTileForPlayer(decision.tile, currentIndex, decision.branch);
      } else if (decision.type === 'resolve-blocked') {
        const blockerIndex = lastTilePlayerIndexRef.current ?? currentIndex;
        applyAuthoritativeTransition(
          reduceAiPracticeBlocked(authoritativeState(), blockerIndex),
        );
      } else if (decision.type === 'draw') {
        drawUntilPlayableForBot(currentIndex);
      } else {
        passTurnInternal(currentIndex);
      }
      botMoveScheduledRef.current = false;
    });
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
    currentTurnPlayerId: players[currentIndex]?.id ?? humanUserId ?? '',
    board,
    myHand: hands[0] ?? [],
    boneyardCount: boneyard.length,
    mode: '1v1',
    roundWinnerPlayerId,
    lastPlayedTile,
    lastScoringEvent,
    teamScores,
    winningTeamId,
    leaderPlayerId: players[leaderIndex]?.id ?? humanUserId ?? '',
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
    completedFinalRevealKey,
    nextRoundCountdown,
  };
}
