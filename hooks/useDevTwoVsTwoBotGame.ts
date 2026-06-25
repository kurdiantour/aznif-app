import { DEV_2V2_BOT_PLAYERS } from '@/lib/dev/devBotPlayers';
import { findBestBotMove } from '@/lib/game/bot-ai';
import { getNextHandKingIndex, NEXT_HAND_OPENING_STATE } from '@/lib/game/king-rules';
import { getNextClockwisePlayer } from '@/lib/game/turn-order';
import { getFinalMatchWinner } from '@/lib/game/match-rules';
import { applyMove, canAnyPlayerMove, canHandMove, createEmptyBoard, isValidMove, roundToNearestFive } from '@/lib/game/kozel-engine';
import type { DominoTileData, KozelBoardState, KozelBranch, Player, TeamId } from '@/types/game';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MockGameState } from './useGameBase';
import { getAvailableBranches, handContainsTile } from './gameRuleQueries';
import { buildRoundResult } from './roundResult';
import { useRoundLifecycle } from './useRoundLifecycle';
import { createAiPracticeDeal, findAiOpeningDoubleAndStarter } from './aiPracticeLocal';
import { PLAYER_TURN_DURATION_SECONDS, pickPreferredBranch } from './gameShared';

const BOT_TURN_DELAY_MS = 5_000;

/** Local-only 2v2 test game. It deliberately has no Supabase dependency. */
export function useDevTwoVsTwoBotGame(): MockGameState {
  const seats = DEV_2V2_BOT_PLAYERS;
  const initialDeal = useMemo(() => createAiPracticeDeal(seats.length), [seats.length]);
  const initialOpening = useMemo(() => findAiOpeningDoubleAndStarter(initialDeal.hands), [initialDeal.hands]);
  const [currentIndex, setCurrentIndex] = useState(initialOpening.starterIndex);
  const [leaderIndex, setLeaderIndex] = useState(initialOpening.starterIndex);
  const [timeLeft, setTimeLeft] = useState(PLAYER_TURN_DURATION_SECONDS);
  const [board, setBoard] = useState<KozelBoardState>(() => createEmptyBoard());
  const [hands, setHands] = useState<DominoTileData[][]>(initialDeal.hands);
  const [boneyard, setBoneyard] = useState<DominoTileData[]>(initialDeal.boneyard);
  const [spinnerValue, setSpinnerValue] = useState<number | null>(null);
  const [isOpeningRound, setIsOpeningRound] = useState(true);
  const [openingDouble, setOpeningDouble] = useState<number | null>(initialOpening.openingDouble);
  const [roundWinnerPlayerId, setRoundWinnerPlayerId] = useState<string | null>(null);
  const [lastPlayedTile, setLastPlayedTile] = useState<DominoTileData | null>(null);
  const [lastPassedPlayerId, setLastPassedPlayerId] = useState<string | null>(null);
  const [lastScoringEvent, setLastScoringEvent] = useState<MockGameState['lastScoringEvent']>(null);
  const [teamScores, setTeamScores] = useState<Record<TeamId, number>>({ teamA: 0, teamB: 0 });
  const [winningTeamId, setWinningTeamId] = useState<TeamId | null>(null);
  const botScheduled = useRef(false);
  const lastTilePlayerIndex = useRef<number | null>(null);
  const passBadgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addPoints = (teamId: TeamId, points: number, playerId: string, openEndsTotal: number) => {
    if (points <= 0) return;
    setTeamScores((previous) => ({ ...previous, [teamId]: previous[teamId] + points }));
    setLastScoringEvent({ teamId, points, playerId, openEndsTotal });
  };
  const showPass = (playerId: string) => {
    if (passBadgeTimer.current) clearTimeout(passBadgeTimer.current);
    setLastPassedPlayerId(playerId);
    passBadgeTimer.current = setTimeout(() => setLastPassedPlayerId(null), 3000);
  };
  useEffect(() => () => { if (passBadgeTimer.current) clearTimeout(passBadgeTimer.current); }, []);
  useEffect(() => {
    if (!roundWinnerPlayerId || winningTeamId) return;
    const winner = getFinalMatchWinner(teamScores);
    if (winner) setWinningTeamId(winner);
  }, [roundWinnerPlayerId, teamScores, winningTeamId]);

  const resolveBlocked = (blockedHands: DominoTileData[][]) => {
    let winnerIndex = 0;
    let lowest = (blockedHands[0] ?? []).reduce((sum, tile) => sum + tile.left + tile.right, 0);
    for (let index = 1; index < seats.length; index += 1) {
      const total = (blockedHands[index] ?? []).reduce((sum, tile) => sum + tile.left + tile.right, 0);
      if (total < lowest) { lowest = total; winnerIndex = index; }
    }
    const winner = seats[winnerIndex];
    const opponentPips = blockedHands.reduce((sum, hand, index) =>
      seats[index].teamId === winner.teamId ? sum : sum + hand.reduce((pips, tile) => pips + tile.left + tile.right, 0), 0);
    addPoints(winner.teamId, roundToNearestFive(opponentPips), winner.id, opponentPips);
    setRoundWinnerPlayerId(winner.id); setLeaderIndex(winnerIndex);
  };
  const startNextRound = useCallback(() => {
    if (!roundWinnerPlayerId) return;
    const nextDeal = createAiPracticeDeal(seats.length);
    const nextLeader = getNextHandKingIndex([...seats], roundWinnerPlayerId);
    botScheduled.current = false; lastTilePlayerIndex.current = null;
    setBoard(createEmptyBoard()); setHands(nextDeal.hands); setBoneyard(nextDeal.boneyard);
    setSpinnerValue(null); setIsOpeningRound(NEXT_HAND_OPENING_STATE.isOpeningRound); setOpeningDouble(NEXT_HAND_OPENING_STATE.openingDouble);
    setRoundWinnerPlayerId(null); setLastPlayedTile(null); setLastPassedPlayerId(null); setLastScoringEvent(null);
    setLeaderIndex(nextLeader); setCurrentIndex(nextLeader); setTimeLeft(PLAYER_TURN_DURATION_SECONDS);
  }, [roundWinnerPlayerId, seats]);
  const createRoundResult = useCallback((winnerId: string) => {
    const winner = seats.find((seat) => seat.id === winnerId);
    return buildRoundResult({ winnerId, winnerTeam: winner?.teamId, awardedPoints: lastScoringEvent?.points ?? 0,
      players: seats.map((seat, playerIndex) => ({ id: seat.id, playerIndex })), hands });
  }, [hands, lastScoringEvent?.points, seats]);
  const { phase, roundResult, nextRoundCountdown } = useRoundLifecycle({ roundWinnerPlayerId, winningTeamId, buildRoundResult: createRoundResult, startNextRound });
  const context = { board, spinnerValue, isOpeningRound, openingDouble };
  const availableBranchesForTile = (tile: DominoTileData) => getAvailableBranches(tile, context);

  const passForPlayer = (playerIndex: number, force = false) => {
    if (roundWinnerPlayerId || winningTeamId || playerIndex !== currentIndex) return false;
    const hand = hands[playerIndex] ?? [];
    if (!force && playerIndex === 0 && board.centerTile && boneyard.length && !canHandMove(hand, board, spinnerValue, isOpeningRound, openingDouble)) return false;
    const nextPlayer = getNextClockwisePlayer([...seats], seats[playerIndex]);
    const nextPlayerIndex = nextPlayer ? seats.indexOf(nextPlayer) : -1;
    if (nextPlayerIndex < 0) return false;
    showPass(seats[playerIndex].id); setLastScoringEvent(null); setCurrentIndex(nextPlayerIndex); setTimeLeft(PLAYER_TURN_DURATION_SECONDS); return true;
  };
  const playForPlayer = (tile: DominoTileData, playerIndex: number, preferredBranch?: KozelBranch) => {
    if (roundWinnerPlayerId || winningTeamId || playerIndex !== currentIndex || !handContainsTile(hands[playerIndex] ?? [], tile.id)) return false;
    const branches = availableBranchesForTile(tile); if (!branches.length) return false;
    const branch = preferredBranch && branches.includes(preferredBranch) ? preferredBranch : pickPreferredBranch(branches, ['up', 'down', 'left', 'right']);
    if (!isValidMove(tile, board, branch, spinnerValue, isOpeningRound, openingDouble)) return false;
    const result = applyMove(board, tile, branch, spinnerValue, isOpeningRound);
    const nextHands = hands.map((hand, index) => index === playerIndex ? hand.filter((item) => item.id !== tile.id) : hand);
    const player = seats[playerIndex];
    if (result.moveScore) addPoints(player.teamId, result.moveScore, player.id, result.moveScore); else setLastScoringEvent(null);
    setBoard(result.board); setHands(nextHands); setSpinnerValue(result.spinnerValue); setIsOpeningRound(false); setOpeningDouble(null); setLastPlayedTile(tile); setLastPassedPlayerId(null); lastTilePlayerIndex.current = playerIndex;
    if (!nextHands[playerIndex].length) {
      const opponentPips = nextHands.reduce((sum, hand, index) => seats[index].teamId === player.teamId ? sum : sum + hand.reduce((pips, item) => pips + item.left + item.right, 0), 0);
      addPoints(player.teamId, roundToNearestFive(opponentPips), player.id, opponentPips); setRoundWinnerPlayerId(player.id); setLeaderIndex(playerIndex); return true;
    }
    if (!canAnyPlayerMove(nextHands, result.board, result.spinnerValue, false, null) && !boneyard.length) { resolveBlocked(nextHands); return true; }
    const nextPlayer = getNextClockwisePlayer([...seats], seats[playerIndex]);
    const nextPlayerIndex = nextPlayer ? seats.indexOf(nextPlayer) : -1;
    if (nextPlayerIndex < 0) return false;
    setCurrentIndex(nextPlayerIndex); setTimeLeft(PLAYER_TURN_DURATION_SECONDS); return true;
  };
  const drawForBot = (playerIndex: number) => {
    const hand = [...(hands[playerIndex] ?? [])]; const remaining = [...boneyard];
    while (remaining.length && !canHandMove(hand, board, spinnerValue, isOpeningRound, openingDouble)) { const tile = remaining.shift(); if (tile) hand.push(tile); }
    setHands((previous) => previous.map((item, index) => index === playerIndex ? hand : item)); setBoneyard(remaining);
    if (!canHandMove(hand, board, spinnerValue, isOpeningRound, openingDouble)) passForPlayer(playerIndex, true);
  };
  const drawTile = () => {
    if (currentIndex !== 0 || !board.centerTile || !boneyard.length || canHandMove(hands[0] ?? [], board, spinnerValue, isOpeningRound, openingDouble)) return false;
    const tile = boneyard[0]; setHands((previous) => previous.map((hand, index) => index === 0 ? [...hand, tile] : hand)); setBoneyard((previous) => previous.slice(1)); return true;
  };
  const humanHand = hands[0] ?? [];
  const hasPlayableTile = canHandMove(humanHand, board, spinnerValue, isOpeningRound, openingDouble);
  const canDrawTile = currentIndex === 0 && !!board.centerTile && !roundWinnerPlayerId && !winningTeamId && !hasPlayableTile && boneyard.length > 0;
  useEffect(() => {
    if (roundWinnerPlayerId || winningTeamId) return;
    const timer = setTimeout(() => setTimeLeft((previous) => {
      if (previous > 1) return previous - 1;
      if (board.centerTile && !canAnyPlayerMove(hands, board, spinnerValue, isOpeningRound, openingDouble) && !boneyard.length) resolveBlocked(hands); else passForPlayer(currentIndex, true);
      return PLAYER_TURN_DURATION_SECONDS;
    }), 1000); return () => clearTimeout(timer);
  }, [timeLeft, currentIndex, board, hands, boneyard, spinnerValue, isOpeningRound, openingDouble, roundWinnerPlayerId, winningTeamId]);
  useEffect(() => {
    const active = seats[currentIndex]; if (!active || active.kind !== 'bot' || roundWinnerPlayerId || winningTeamId) { botScheduled.current = false; return; }
    if (botScheduled.current) return; botScheduled.current = true;
    const timer = setTimeout(() => { const move = findBestBotMove(hands[currentIndex] ?? [], board, spinnerValue, isOpeningRound, openingDouble);
      if (move) playForPlayer(move.tile, currentIndex, move.branch); else if (board.centerTile && boneyard.length) drawForBot(currentIndex); else passForPlayer(currentIndex, true); botScheduled.current = false; }, BOT_TURN_DELAY_MS);
    return () => { clearTimeout(timer); botScheduled.current = false; };
  }, [currentIndex, board, hands, boneyard, spinnerValue, isOpeningRound, openingDouble, roundWinnerPlayerId, winningTeamId, seats]);
  const players: Player[] = seats.map((seat, index) => ({ ...seat, isActive: index === currentIndex, timeLeft: index === currentIndex ? timeLeft : PLAYER_TURN_DURATION_SECONDS, tileCount: hands[index]?.length ?? 0, score: teamScores[seat.teamId], isLeader: index === leaderIndex }));
  return { players, currentTurnPlayerId: players[currentIndex]?.id ?? seats[0].id, board, myHand: humanHand, boneyardCount: boneyard.length, mode: '2v2', roundWinnerPlayerId, lastPlayedTile, lastScoringEvent, teamScores, winningTeamId, leaderPlayerId: players[leaderIndex]?.id ?? seats[0].id, isFirstRound: isOpeningRound, availableBranchesForTile, playTile: (tile, branch) => playForPlayer(tile, 0, branch), passTurn: () => passForPlayer(0), drawTile, canDrawTile, hasPlayableTile, lastPassedPlayerId, phase, roundResult, nextRoundCountdown };
}
