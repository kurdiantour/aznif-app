import { findBestBotMove } from '@/domino/core/bot/bot-ai';
import { FULL_DOMINO_SET } from '@/domino/core/constants/domino-set';
import { applyMove, canAnyPlayerMove, createEmptyBoard, isValidMove } from '@/domino/core/engine/kozel-engine';
import { dealDominoHands } from '@/domino/core/setup/deal';
import { shuffleArray } from '@/domino/core/setup/shuffle';
import type { DominoGameViewModel } from '@/domino/shared/contracts/domino-game-view-model';
import { PLAYER_TURN_DURATION_SECONDS } from '@/domino/shared/game-shared';
import { buildRoundResult } from '@/domino/shared/lifecycle/round-result';
import { useRoundLifecycle } from '@/domino/shared/lifecycle/use-round-lifecycle';
import { getAvailableBranches, handHasPlayableTile } from '@/domino/shared/rules/game-rule-queries';
import type { DominoTileData, KozelBranch, Player, TeamId } from '@/domino/types/domino-game';
import { useCallback, useEffect, useRef, useState } from 'react';
import { reduceTwoVsTwoPass, reduceTwoVsTwoPlay, type TwoVsTwoPlayer, type TwoVsTwoTransition } from '../authoritative/domino-two-vs-two-command-reducer';
import { finalizeTwoVsTwoRound, startTwoVsTwoNextHand } from '../lifecycle/domino-two-vs-two-round-transition';

const roster: TwoVsTwoPlayer[] = [
  { user_id: 'preview-you', team_id: 'teamA', player_index: 0 },
  { user_id: 'preview-bot-1', team_id: 'teamB', player_index: 1 },
  { user_id: 'preview-bot-2', team_id: 'teamA', player_index: 2 },
  { user_id: 'preview-bot-3', team_id: 'teamB', player_index: 3 },
];
type Match = { state: any; hands: DominoTileData[][]; boneyard: DominoTileData[]; version: number; terminal: TwoVsTwoTransition | null };

function freshMatch(): Match {
  const { hands, boneyard } = dealDominoHands(shuffleArray(FULL_DOMINO_SET), 4);
  let double = -1, king = 0;
  hands.forEach((hand, i) => hand.forEach((tile) => {
    if (tile.left === tile.right && tile.left > double) { double = tile.left; king = i; }
  }));
  const kingId = roster[king].user_id, now = new Date().toISOString();
  return { hands, boneyard, version: 0, terminal: null, state: {
    mode: '2v2', status: 'active', board: createEmptyBoard(), spinnerValue: null,
    handCounts: hands.map((hand) => hand.length), boneyardCount: boneyard.length,
    currentTurnPlayerId: kingId, leaderPlayerId: kingId, turnStartedAt: now, roundStartsAt: now,
    isOpeningRound: true, isFirstRound: true, openingDouble: double, openingTileId: `${double}-${double}`,
    roundWinnerPlayerId: null, roundEndReason: null, teamScores: { teamA: 0, teamB: 0 },
    winningTeamId: null, matchReward: null, lastPlayedTile: null, lastScoringEvent: null,
    endOfHandScoringEvent: null, lastPassedPlayerId: null, blockedPasses: [], canDrawTile: false,
  }};
}

export type LocalTwoVsTwoPreviewGame = DominoGameViewModel & {
  restartGame(): void; currentUserId: string; loading: false; error: null; rawState: any;
};

export function useLocalTwoVsTwoPreviewGame(enabled = true): LocalTwoVsTwoPreviewGame {
  const [match, setMatch] = useState<Match>(freshMatch);
  const [timeLeft, setTimeLeft] = useState(PLAYER_TURN_DURATION_SECONDS);
  const botBusy = useRef(false);
  const { state, hands, boneyard } = match;
  const board = state.board, spinnerValue = state.spinnerValue ?? null;
  const isOpeningRound = Boolean(state.isOpeningRound ?? state.isFirstRound ?? false);
  const openingDouble = typeof state.openingDouble === 'number' ? state.openingDouble : null;
  const currentIndex = roster.findIndex((p) => p.user_id === state.currentTurnPlayerId);
  const context = { board, spinnerValue, isOpeningRound, openingDouble };

  const restartGame = useCallback(() => {
    botBusy.current = false; setTimeLeft(PLAYER_TURN_DURATION_SECONDS); setMatch(freshMatch());
  }, []);
  const accept = useCallback((next: TwoVsTwoTransition) => {
    setMatch((old) => {
      const committed = next.nextState.roundWinnerPlayerId
        ? finalizeTwoVsTwoRound({
            transition: next,
            roomId: 'local-2v2-preview',
            committedVersion: old.version + 1,
            completedAt: new Date().toISOString(),
          })
        : next;
      return {
        state: committed.nextState,
        hands: committed.nextHands as DominoTileData[][],
        boneyard: committed.nextBoneyard as DominoTileData[],
        version: old.version + 1,
        terminal: committed.nextState.roundWinnerPlayerId ? committed : null,
      };
    });
    setTimeLeft(PLAYER_TURN_DURATION_SECONDS);
    return true;
  }, []);

  const playFor = useCallback((index: number, tile: DominoTileData, requested?: KozelBranch) => {
    if (!enabled || state.roundWinnerPlayerId || state.winningTeamId || roster[index]?.user_id !== state.currentTurnPlayerId) return false;
    const branch = requested ?? getAvailableBranches(tile, context)[0];
    if (!branch || !isValidMove(tile, board, branch, spinnerValue, isOpeningRound, openingDouble)) return false;
    const applied = applyMove(board, tile, branch, spinnerValue, isOpeningRound);
    return accept(reduceTwoVsTwoPlay({ state, hands, boneyard, players: roster, playerIndex: index,
      actorUserId: roster[index].user_id, tile, branch, nextBoard: applied.board,
      nextSpinnerValue: applied.spinnerValue, moveScore: applied.moveScore,
      phaseStartedAt: new Date().toISOString(), isSameTile: (a, b) => a.id === b.id,
      canAnyPlayerMove: (nextHands, nextBoard, spinner) => canAnyPlayerMove(nextHands, nextBoard, spinner, false, null),
    }));
  }, [accept, boneyard, board, context, enabled, hands, isOpeningRound, openingDouble, spinnerValue, state]);

  const passFor = useCallback((index: number, timedOut = false) => {
    if (!enabled || state.roundWinnerPlayerId || state.winningTeamId || roster[index]?.user_id !== state.currentTurnPlayerId) return false;
    return accept(reduceTwoVsTwoPass({ state, hands, boneyard, players: roster, playerIndex: index,
      currentTurnPlayerId: state.currentTurnPlayerId, timedOut, phaseStartedAt: new Date().toISOString() }));
  }, [accept, boneyard, enabled, hands, state]);

  const makeResult = useCallback((winnerId: string) => buildRoundResult({ winnerId,
    winnerTeam: roster.find((p) => p.user_id === winnerId)?.team_id, endReason: state.roundEndReason ?? undefined,
    awardedPoints: state.endOfHandScoringEvent?.points ?? 0,
    players: roster.map((p) => ({ id: p.user_id, playerIndex: p.player_index })), hands,
  }), [hands, state.endOfHandScoringEvent?.points, state.roundEndReason]);
  const startNextRound = useCallback(() => {
    if (!match.terminal || state.winningTeamId) return;
    const next = startTwoVsTwoNextHand({
      state,
      players: roster,
      startedAt: new Date().toISOString(),
      shuffleSeed: Date.now(),
    });
    setMatch({ state: next.nextState, hands: next.nextHands as DominoTileData[][],
      boneyard: next.nextBoneyard as DominoTileData[], version: match.version + 1, terminal: null });
    setTimeLeft(PLAYER_TURN_DURATION_SECONDS);
  }, [match.terminal, match.version, state]);
  const lifecycle = useRoundLifecycle({ roundWinnerPlayerId: state.roundWinnerPlayerId ?? null,
    winningTeamId: state.winningTeamId ?? null, buildRoundResult: makeResult, startNextRound });

  useEffect(() => {
    if (!enabled || currentIndex < 0 || state.roundWinnerPlayerId || state.winningTeamId) return;
    const id = setInterval(() => setTimeLeft((left) => {
      if (left > 1) return left - 1;
      setTimeout(() => passFor(currentIndex, true), 0); return PLAYER_TURN_DURATION_SECONDS;
    }), 1000);
    return () => clearInterval(id);
  }, [currentIndex, enabled, passFor, state.roundWinnerPlayerId, state.winningTeamId]);
  useEffect(() => {
    if (!enabled || currentIndex <= 0 || state.roundWinnerPlayerId || state.winningTeamId || botBusy.current) return;
    botBusy.current = true;
    const id = setTimeout(() => {
      const move = findBestBotMove(hands[currentIndex] ?? [], board, spinnerValue, isOpeningRound, openingDouble);
      if (move) playFor(currentIndex, move.tile, move.branch); else passFor(currentIndex);
      botBusy.current = false;
    }, 3_000);
    return () => { clearTimeout(id); botBusy.current = false; };
  }, [board, currentIndex, enabled, hands, isOpeningRound, openingDouble, passFor, playFor,
    spinnerValue, state.roundWinnerPlayerId, state.winningTeamId]);

  const players: Player[] = roster.map((p, i) => ({ id: p.user_id, name: i ? `Local Bot ${i}` : 'You',
    seat: (['bottom', 'right', 'top', 'left'] as const)[i], kind: i ? 'bot' : 'human', teamId: p.team_id,
    isActive: i === currentIndex, timeLeft: i === currentIndex ? timeLeft : PLAYER_TURN_DURATION_SECONDS,
    tileCount: hands[i]?.length ?? 0, score: state.teamScores?.[p.team_id] ?? 0,
    isLeader: p.user_id === state.leaderPlayerId }));
  const myHand = hands[0] ?? [];
  return { players, currentTurnPlayerId: state.currentTurnPlayerId, board, myHand,
    boneyardCount: boneyard.length, mode: '2v2', roundWinnerPlayerId: state.roundWinnerPlayerId ?? null,
    lastPlayedTile: state.lastPlayedTile ?? null, lastScoringEvent: state.lastScoringEvent ?? null,
    endOfHandScoringEvent: state.endOfHandScoringEvent ?? null,
    teamScores: state.teamScores as Record<TeamId, number>, winningTeamId: state.winningTeamId ?? null,
    matchReward: state.matchReward ?? null, leaderPlayerId: state.leaderPlayerId, isFirstRound: isOpeningRound,
    phase: lifecycle.phase, roundResult: lifecycle.roundResult, nextRoundCountdown: lifecycle.nextRoundCountdown,
    availableBranchesForTile: (tile) => getAvailableBranches(tile, context),
    playTile: (tile, branch) => playFor(0, tile, branch), passTurn: () => passFor(0), drawTile: () => false,
    canDrawTile: false, hasPlayableTile: handHasPlayableTile(myHand, context),
    lastPassedPlayerId: state.lastPassedPlayerId ?? null, restartGame,
    currentUserId: roster[0].user_id, loading: false, error: null, rawState: state };
}
