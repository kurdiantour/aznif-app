import { createEmptyBoard } from '@/domino/core/engine/kozel-engine';
import { shouldExitLocalHumanAfterTakeover } from '@/domino/shared/lifecycle/local-takeover-exit-policy';
import { assignDominoBotIdentities } from '@/domino/shared/bot-identity';
import { MultiplayerRequestError } from '@/lib/multiplayer/core/http-command-client';
import type { DominoTwoVsTwoTurnTimeoutClaim } from '../adapters/domino-two-vs-two-adapter';
import type { PendingMultiplayerMove } from '@/domino/shared/optimistic/domino-optimistic-move';
import { getSnapshotVersion } from '@/lib/multiplayer/core/versioning';
import { calculateLevelFromPoints } from '@/lib/progression';
import type { DominoTileData,
    KozelBoardState,
    KozelBranch,
    MatchReward,
    ScoringEvent,
    TeamId,
} from '@/domino/types/domino-game';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DominoGameViewModel } from '@/domino/shared/contracts/domino-game-view-model';
import { getAvailableBranches, handHasPlayableTile } from '@/domino/shared/rules/game-rule-queries';
import { getPlayerIndex, getRelativeSeat } from '@/lib/multiplayer/core/player-normalization';
import { runMultiplayerAction } from '@/lib/multiplayer/core/multiplayer-action';
import { buildRoundResult } from '@/domino/shared/lifecycle/round-result';
import { useRoundLifecycle } from '@/domino/shared/lifecycle/use-round-lifecycle';
import { PLAYER_TURN_DURATION_SECONDS, ROUND_TRANSITION_SYNC_MS } from '@/domino/shared/game-shared';
import { SupabaseDominoTwoVsTwoAdapter } from '../adapters/supabase-domino-two-vs-two-adapter';
import { createDominoTwoVsTwoPendingMove, isDominoTwoVsTwoMoveCommitted, normalizeDominoTwoVsTwoSnapshot } from './domino-two-vs-two-controller';
import { useDominoTwoVsTwoBotController } from './domino-two-vs-two-bot-controller';
import { useDominoTwoVsTwoConnectionController } from './domino-two-vs-two-connection-controller';
import { useDominoTwoVsTwoTimeoutController, useDominoTwoVsTwoTurnClock } from './domino-two-vs-two-timeout-controller';
import { useDominoTwoVsTwoRoundSync } from './use-domino-two-vs-two-round-sync';

type UseTwoVsTwoResult = Omit<DominoGameViewModel, 'playTile' | 'passTurn'> & {
  loading: boolean;
  error: string | null;
  rawState: any;
  pendingMove: PendingMultiplayerMove | null;
  currentUserId: string | null;
  localPlayerTakenOver: boolean;
  playTile: (tile: DominoTileData, branch?: KozelBranch) => Promise<any>;
  passTurn: () => Promise<boolean>;
};

export function useTwoVsTwoGame(roomId?: string): UseTwoVsTwoResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawState, setRawState] = useState<any>(null);
  const [playersRows, setPlayersRows] = useState<any[]>([]);
  const [profileById, setProfileById] = useState<Map<string, any>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMultiplayerMove | null>(null);
  const adapter = useMemo(() => roomId ? new SupabaseDominoTwoVsTwoAdapter(roomId) : null, [roomId]);

  const latestVersionRef = useRef(-1);
  const rawStateRef = useRef<any>(null);
  const pendingMoveRef = useRef<PendingMultiplayerMove | null>(null);
  const timeoutPassInFlightRef = useRef(false);
  const timeoutRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTurnKeyRef = useRef<string | null>(null);
  const serverClockOffsetMsRef = useRef(0);
  const roomIdRef = useRef(roomId);
  const timeoutSubmitRef = useRef<((claim: DominoTwoVsTwoTurnTimeoutClaim, turnKey: string, claimRoomId: string) => void) | null>(null);


  const clearTimeoutRetry = useCallback(() => {
    if (timeoutRetryRef.current) {
      clearTimeout(timeoutRetryRef.current);
      timeoutRetryRef.current = null;
    }
  }, []);

  useEffect(() => {
    roomIdRef.current = roomId;
    latestVersionRef.current = -1;
    rawStateRef.current = null;
    pendingMoveRef.current = null;
    activeTurnKeyRef.current = null;
    timeoutPassInFlightRef.current = false;
    clearTimeoutRetry();
    setPendingMove(null);

    return () => {
      activeTurnKeyRef.current = null;
      timeoutPassInFlightRef.current = false;
      clearTimeoutRetry();
    };
  }, [roomId, clearTimeoutRetry]);

  const applySnapshot = useCallback((snapshot: any) => {
    const version = getSnapshotVersion(snapshot);
    if (version >= 0 && version < latestVersionRef.current) return false;
    if (version >= 0) latestVersionRef.current = version;

    const nextRawState = normalizeDominoTwoVsTwoSnapshot(snapshot);
    const turnStartedAt = nextRawState.turnStartedAt ?? nextRawState.updated_at ?? null;
    const currentTurnPlayerId = nextRawState.currentTurnPlayerId ?? null;
    activeTurnKeyRef.current =
      version >= 0 && typeof turnStartedAt === 'string' && typeof currentTurnPlayerId === 'string'
        ? `${version}:${turnStartedAt}:${currentTurnPlayerId}`
        : null;
    clearTimeoutRetry();
    rawStateRef.current = nextRawState;
    setRawState(nextRawState);
    const pending = pendingMoveRef.current;
    if (
      pending &&
      version > pending.baseVersion &&
      isDominoTwoVsTwoMoveCommitted(nextRawState, version, pending)
    ) {
      pendingMoveRef.current = null;
      setPendingMove(null);
    }
    return true;
  }, [clearTimeoutRetry]);

  const refreshSnapshot = useCallback(async () => {
    if (!roomId) throw new Error('No 2v2 room id');
    if (!adapter) throw new Error('No 2v2 room id');
    const data = await adapter.getSnapshot();
    applySnapshot(data);
    return data;
  }, [roomId, adapter, applySnapshot]);

  const loadPlayers = useCallback(async (includeProfiles = true) => {
    if (!adapter) throw new Error('No 2v2 room id');
    const { rows, profiles } = await adapter.getRoster(includeProfiles);
    setPlayersRows(rows);
    if (profiles !== null) {
      setProfileById(
        new Map((profiles ?? []).map((profile: any) => [profile.id, profile])),
      );
    }
  }, [adapter]);

  const applyRealtimeRoom = useCallback((updatedRoom: unknown) => {
    if (!updatedRoom) return;

    // IMPORTANT:
    // A 2v2 Realtime room payload contains public room state only.
    // Never merge that public state with private hand data from the previous
    // snapshot. Doing so can create an impossible mixed snapshot at a round
    // boundary (for example: Round 2 board/turn + Round 1 private hand).
    //
    // The connection controller immediately follows room invalidation with
    // refreshSnapshot(), which fetches the authoritative snapshot containing
    // both the current public state and this player's current private hand.
    // Until that full snapshot arrives, keep rendering the last internally
    // consistent snapshot instead of publishing a partially-updated one.
    //
    // This intentionally makes Realtime an invalidation signal, not a second
    // source of truth.
  }, []);

  useDominoTwoVsTwoConnectionController({
    roomId,
    loading,
    status: rawState?.status ?? null,
    handCounts: rawState?.handCounts,
    playersCount: playersRows.length,
    winningTeamId: rawState?.winningTeamId ?? null,
    adapter,
    refreshSnapshot,
    loadPlayers,
    applyRealtimeRoom,
    setLoading,
    setError,
    setCurrentUserId,
    rawState,
    currentUserId,
    players: playersRows,
    privateHandCount: rawState?.myHand?.length ?? 0,
  });


  const myPlayerIndex = useMemo(() => {
    if (!currentUserId) return -1;
    return getPlayerIndex(playersRows, (row) => row.user_id === currentUserId);
  }, [playersRows, currentUserId]);

  const board: KozelBoardState = rawState?.board ?? createEmptyBoard();
  const currentTurnPlayerId =
    rawState?.currentTurnPlayerId ??
    rawState?.current_turn_player_id ??
    playersRows[0]?.user_id ??
    '';

  const turnTimeLeft = useDominoTwoVsTwoTurnClock({
    currentTurnPlayerId,
    rawState,
    serverClockOffsetMsRef,
    durationSeconds: PLAYER_TURN_DURATION_SECONDS,
  });

  const localPlayerTakenOver = useMemo(
    () => shouldExitLocalHumanAfterTakeover(currentUserId, playersRows),
    [playersRows, currentUserId],
  );

  const players = useMemo(() => {
    const state = rawState ?? {};
    const handCounts = state.handCounts ?? [];
    const botIdentities = assignDominoBotIdentities(
      playersRows.map((row) => ({
          id: String(row.id),
          playerIndex: typeof row.player_index === 'number' ? row.player_index : -1,
        })),
    );

    return playersRows.map((row) => {
      const playerId = row.user_id ?? 'bot-' + String(row.id);
      const profile = row.user_id ? profileById.get(row.user_id) : null;
      const playerIndex =
        typeof row.player_index === 'number' ? row.player_index : -1;
      const isBot = row.bot_takeover || row.kind === 'bot' || !row.user_id;
      return {
        id: playerId,
        name: isBot
          ? botIdentities.get(String(row.id))!.name
          : profile?.username ?? 'Player',
        seat: getRelativeSeat(playerIndex, myPlayerIndex, 4),
        kind: row.kind,
        teamId: row.team_id,
        isActive: playerId === state.currentTurnPlayerId,
        timeLeft: playerId === state.currentTurnPlayerId
          ? turnTimeLeft
          : PLAYER_TURN_DURATION_SECONDS,
        tileCount: playerIndex >= 0 ? handCounts[playerIndex] ?? 0 : 0,
        score: state.teamScores?.[row.team_id] ?? 0,
        isLeader: state.leaderPlayerId ? playerId === state.leaderPlayerId : false,
        avatarId: profile?.avatar_id,
        level: calculateLevelFromPoints(profile?.points),
        points: profile?.points,
      };
    });
  }, [playersRows, profileById, rawState, myPlayerIndex, turnTimeLeft]);
  useDominoTwoVsTwoBotController({
    roomId,
    loading,
    currentTurnPlayerId,
    winningTeamId: rawState?.winningTeamId ?? null,
    roundWinnerPlayerId: rawState?.roundWinnerPlayerId ?? null,
    players: playersRows,
    adapter,
  });
  const teamScores: Record<TeamId, number> = {
    teamA: rawState?.teamScores?.teamA ?? 0,
    teamB: rawState?.teamScores?.teamB ?? 0,
  };

  const myHand: DominoTileData[] = useMemo(() => {
    const snapshotHands = rawState?.privateHands ?? rawState?.debugPrivateHandsRaw;
    if (
      myPlayerIndex >= 0 &&
      Array.isArray(snapshotHands) &&
      Array.isArray(snapshotHands[myPlayerIndex])
    ) {
      return snapshotHands[myPlayerIndex];
    }

    return rawState?.myHand ?? [];
  }, [rawState, myPlayerIndex]);

  const openingDouble =
    typeof rawState?.openingDouble === 'number' ? rawState.openingDouble : null;

  const isOpeningRound = Boolean(
    rawState?.isOpeningRound ?? rawState?.isFirstRound ?? false,
  );

  const playabilityContext = { board, spinnerValue: rawState?.spinnerValue ?? null, isOpeningRound, openingDouble };
  const availableBranchesForTile = (tile: DominoTileData): KozelBranch[] =>
    getAvailableBranches(tile, playabilityContext);

  const hasPlayableTile = useMemo(() => {
    return handHasPlayableTile(myHand, playabilityContext);
  }, [myHand, board, rawState, isOpeningRound, openingDouble]);

  const playTile = async (tile: DominoTileData, branch?: KozelBranch) => {
    if (!roomId) throw new Error('No 2v2 room id');
    if (rawState?.roundWinnerPlayerId) {
      console.warn('[2v2 playTile rejected]', {
        reason: 'round_winner_player_id',
        roomId,
        tileId: tile.id,
        snapshotVersion: latestVersionRef.current,
        roundWinnerPlayerId: rawState?.roundWinnerPlayerId ?? null,
      });
      return false;
    }

    const resolvedBranch = branch ?? availableBranchesForTile(tile)[0];
    if (!resolvedBranch) {
      console.warn('[2v2 playTile rejected]', {
        reason: 'no_available_branch',
        roomId,
        tileId: tile.id,
        requestedBranch: branch ?? null,
        snapshotVersion: latestVersionRef.current,
        boardEmpty: !board.centerTile,
        isOpeningRound,
        openingDouble,
      });
      return false;
    }

    const pending = createDominoTwoVsTwoPendingMove({
      roomId, tile, branch: resolvedBranch,
      baseVersion: latestVersionRef.current, board,
      spinnerValue: rawState?.spinnerValue ?? null, isOpeningRound,
    });
    pendingMoveRef.current = pending;
    setPendingMove(pending);

    try {
      const result = await adapter!.dispatch({ type: 'play', tile, branch: resolvedBranch });
      if (result?.ok) {
        applySnapshot(result);
      }
      return result;
    } catch (error) {
      if (error instanceof MultiplayerRequestError && error.ambiguous) {
        try {
          await refreshSnapshot();
          if (!pendingMoveRef.current) return { ok: true };
        } catch {
          // The original request remains unconfirmed; roll back the visual layer.
        }
      }

      if (pendingMoveRef.current?.requestId === pending.requestId) {
        pendingMoveRef.current = null;
        setPendingMove(null);
      }
      throw error;
    }
  };

  const drawTile = () => false;

  const passTurn = async () => {
    if (!roomId) return false;
    // Game rule: passing is illegal before the opening tile is on the board.
    if (
      !board.centerTile ||
      currentTurnPlayerId !== currentUserId ||
      hasPlayableTile ||
      rawState?.roundWinnerPlayerId ||
      rawState?.winningTeamId
    ) return false;

    return runMultiplayerAction({
      action: () => adapter!.dispatch({ type: 'pass' }),
      onSuccess: (result) => !!result?.ok,
      errorLabel: 'submit_two_vs_two action=pass failed',
    });
  };

  useDominoTwoVsTwoTimeoutController({
    roomId,
    turnTimeLeft,
    currentTurnPlayerId,
    rawState,
    currentUserId,
    adapter,
    refreshSnapshot,
    roomIdRef,
    activeTurnKeyRef,
    serverClockOffsetMsRef,
    timeoutPassInFlightRef,
    timeoutRetryRef,
    timeoutSubmitRef,
    clearTimeoutRetry,
  });
  const createRoundResult = useCallback((winnerId: string) => {
    const completedRound = rawState?.lastCompletedRound;
    const snapshotHands = completedRound?.hands ?? rawState?.debugPrivateHandsRaw ?? rawState?.privateHands ?? [];
    const winnerTeam = playersRows.find(
      (row) => (row.user_id ?? `bot-${row.id}`) === winnerId,
    )?.team_id;
    return buildRoundResult({
      winnerId,
      winnerTeam,
      endReason: completedRound?.endReason ?? rawState?.roundEndReason,
      awardedPoints: completedRound?.endOfHandScoringEvent?.points ?? rawState?.endOfHandScoringEvent?.points ?? 0,
      players: playersRows.map((row) => ({
        id: row.user_id ?? `bot-${row.id}`,
        playerIndex: typeof row.player_index === 'number' ? row.player_index : -1,
      })),
      hands: Array.isArray(snapshotHands) ? snapshotHands : [],
    });
  }, [playersRows, rawState]);

  const roundWinnerPlayerId = rawState?.roundWinnerPlayerId ?? null;
  const winningTeamId = rawState?.winningTeamId ?? null;
  const completedRoundId = rawState?.lastCompletedRound?.id ?? null;
  const { startNextRound } = useDominoTwoVsTwoRoundSync({
    roomId,
    adapter,
    completedRoundId,
    roundWinnerPlayerId,
    winningTeamId,
    status: rawState?.status,
    hasAuthoritativeActiveHand:
      rawState?.status === 'started' &&
      !roundWinnerPlayerId &&
      !winningTeamId &&
      !!rawState?.currentTurnPlayerId &&
      Array.isArray(rawState?.myHand) &&
      rawState.myHand.length > 0,
    syncIntervalMs: ROUND_TRANSITION_SYNC_MS,
    applySnapshot,
    refreshSnapshot,
  });
  const { phase, roundResult, completedFinalRevealKey, nextRoundCountdown } = useRoundLifecycle({
    roundWinnerPlayerId,
    winningTeamId,
    buildRoundResult: createRoundResult,
    startNextRound,
  });

  return {
    loading,
    error,

    players,
    currentTurnPlayerId,
    board,
    myHand,
    boneyardCount: rawState?.boneyardCount ?? 0,
    mode: '2v2',

    roundWinnerPlayerId: rawState?.roundWinnerPlayerId ?? null,
    lastPlayedTile: rawState?.lastPlayedTile ?? null,
    lastScoringEvent: rawState?.lastScoringEvent as ScoringEvent | null,
    endOfHandScoringEvent: rawState?.endOfHandScoringEvent as ScoringEvent | null,
    teamScores,
    winningTeamId: rawState?.winningTeamId ?? null,
    matchReward: rawState?.matchReward as MatchReward | null,

    leaderPlayerId: rawState?.leaderPlayerId ?? players[0]?.id ?? '',
    isFirstRound: isOpeningRound,

    availableBranchesForTile,
    playTile,
    passTurn,
    drawTile,

    canDrawTile: Boolean(rawState?.canDrawTile ?? false),
    hasPlayableTile,
    lastPassedPlayerId: rawState?.lastPassedPlayerId ?? null,

    phase,
    roundResult,
    completedFinalRevealKey,
    nextRoundCountdown,

    rawState,
    pendingMove,
    currentUserId,
    localPlayerTakenOver,
  };
}