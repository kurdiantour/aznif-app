import { applyMove, createEmptyBoard } from '@/lib/game/kozel-engine';
import {
  submitTwoVsTwoMove,
  submitTwoVsTwoPass,
  MultiplayerRequestError,
} from '@/lib/multiplayer/multiplayerApi';
import {
  boardContainsMove,
  getSnapshotVersion,
  type PendingMultiplayerMove,
} from '@/lib/multiplayer/optimisticMove';
import { supabase } from '@/lib/supabase';
import type {
    DominoTileData,
    KozelBoardState,
    KozelBranch,
    MatchReward,
    RoundPhase,
    RoundResult,
    ScoringEvent,
    TeamId,
} from '@/types/game';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MockGameState } from './useGameBase';
import { getAvailableBranches, handHasPlayableTile } from './gameRuleQueries';
import { getPlayerIndex, getRelativeSeat } from './multiplayerPlayerNormalization';
import { runMultiplayerAction } from './multiplayerAction';
import { buildRoundResult } from './roundResult';
import { useRoundLifecycle } from './useRoundLifecycle';
import {
  NEXT_ROUND_COUNTDOWN_SECONDS,
  PLAYER_TURN_DURATION_SECONDS,
  ROUND_RESULT_REVEAL_MS,
} from './gameShared';

type UseTwoVsTwoResult = Omit<MockGameState, 'playTile' | 'passTurn'> & {
  loading: boolean;
  error: string | null;
  rawState: any;
  pendingMove: PendingMultiplayerMove | null;
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
  const [turnTimeLeft, setTurnTimeLeft] = useState(PLAYER_TURN_DURATION_SECONDS);

  const roomChannelRef = useRef<any>(null);
  const playersChannelRef = useRef<any>(null);
  const botTurnInFlightRef = useRef(false);
  const latestVersionRef = useRef(-1);
  const pendingMoveRef = useRef<PendingMultiplayerMove | null>(null);
  const timeoutPassInFlightRef = useRef(false);


  useEffect(() => {
    latestVersionRef.current = -1;
    pendingMoveRef.current = null;
    setPendingMove(null);
  }, [roomId]);

  const applySnapshot = useCallback((snapshot: any) => {
    const version = getSnapshotVersion(snapshot);
    if (version >= 0 && version < latestVersionRef.current) return false;
    if (version >= 0) latestVersionRef.current = version;

    const room = snapshot?.room ?? snapshot ?? {};
    const state = snapshot?.state ?? room?.state ?? {};
    const nextRawState = {
      ...room,
      ...state,
      mode: '2v2',
      currentTurnPlayerId:
        state?.currentTurnPlayerId ?? room?.current_turn_player_id ?? null,
    };
    setRawState(nextRawState);
    const pending = pendingMoveRef.current;
    if (
      pending &&
      version > pending.baseVersion &&
      boardContainsMove(nextRawState.board, pending.tile.id, pending.branch)
    ) {
      pendingMoveRef.current = null;
      setPendingMove(null);
    }
    return true;
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!roomId) throw new Error('No 2v2 room id');
    const { data, error } = await supabase.rpc('get_two_vs_two_snapshot', {
      p_room_id: roomId,
    });
    if (error) throw error;
    applySnapshot(data);
    return data;
  }, [roomId, applySnapshot]);

  useEffect(() => {
    if (!roomId) {
      setError('No 2v2 room id');
      setLoading(false);
      return;
    }

    let mounted = true;

    const loadRoom = async () => {
      const data = await refreshSnapshot();
      if (!mounted) return;
      return data;
    };

    const loadPlayers = async () => {
      const { data, error } = await supabase
        .from('two_vs_two_players')
        .select('id, user_id, player_index, seat, team_id, kind, connected, bot_takeover, abandoned')
        .eq('room_id', roomId)
        .order('player_index', { ascending: true });

      if (error) throw error;
      if (!mounted) return;

      const rows = data ?? [];
      setPlayersRows(rows);

      const userIds = rows.map((row: any) => row.user_id).filter(Boolean);

      if (userIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, avatar_id, level, points')
          .in('id', userIds);

        if (mounted) {
          setProfileById(new Map((profiles ?? []).map((p: any) => [p.id, p])));
        }
      } else {
        setProfileById(new Map());
      }
    };

    const boot = async () => {
      try {
        setLoading(true);
        setError(null);

        const userResp = await supabase.auth.getUser();
        if (!mounted) return;

        setCurrentUserId(userResp.data.user?.id ?? null);

        if (userResp.data.user?.id) {
          await supabase.rpc('restore_two_vs_two_human_control', {
            p_room_id: roomId,
          });
        }

        await Promise.all([loadRoom(), loadPlayers()]);

        roomChannelRef.current = supabase
          .channel(`two_vs_two_rooms:${roomId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'two_vs_two_rooms',
              filter: `id=eq.${roomId}`,
            },
            () => {
              if (!mounted) return;
              void loadRoom();
            },
          )
          .subscribe((status, err) => {
            if (!mounted) return;
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setError(err?.message ?? 'Realtime sync failed');
            }
          });

        playersChannelRef.current = supabase
          .channel(`two_vs_two_players:${roomId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'two_vs_two_players',
              filter: `room_id=eq.${roomId}`,
            },
            () => {
              if (!mounted) return;
              void loadPlayers();
            },
          )
          .subscribe((status, err) => {
            if (!mounted) return;
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setError(err?.message ?? 'Realtime player sync failed');
            }
          });

        if (mounted) setLoading(false);
      } catch (err: any) {
        if (!mounted) return;
        setError(err?.message ?? String(err));
        setLoading(false);
      }
    };

    void boot();

    return () => {
      mounted = false;

      if (roomChannelRef.current) {
        void supabase.removeChannel(roomChannelRef.current);
        roomChannelRef.current = null;
      }

      if (playersChannelRef.current) {
        void supabase.removeChannel(playersChannelRef.current);
        playersChannelRef.current = null;
      }
    };
  }, [roomId, applySnapshot, refreshSnapshot]);

  useEffect(() => {
    if (!roomId || !currentUserId) return;

    const heartbeat = async () => {
      const { error } = await supabase.rpc('two_vs_two_player_heartbeat', {
        p_room_id: roomId,
      });
      if (error) console.warn('2v2 heartbeat failed', error);
    };

    void heartbeat();
    const interval = setInterval(() => void heartbeat(), 10_000);
    return () => clearInterval(interval);
  }, [roomId, currentUserId]);

  const myPlayerIndex = useMemo(() => {
    if (!currentUserId) return -1;
    return getPlayerIndex(playersRows, (row) => row.user_id === currentUserId);
  }, [playersRows, currentUserId]);

  const players = useMemo(() => {
    const state = rawState ?? {};
    const handCounts = state.handCounts ?? [];

    return playersRows.map((row) => {
      const playerId = row.user_id ?? `bot-${row.id}`;
      const profile = row.user_id ? profileById.get(row.user_id) : null;
      const playerIndex =
        typeof row.player_index === 'number' ? row.player_index : -1;

      return {
        id: playerId,
        name: profile?.username ?? (row.user_id ? 'Player' : 'Bot'),
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
      };
    });
  }, [playersRows, profileById, rawState, myPlayerIndex, turnTimeLeft]);

  const board: KozelBoardState = rawState?.board ?? createEmptyBoard();

  const currentTurnPlayerId =
    rawState?.currentTurnPlayerId ??
    rawState?.current_turn_player_id ??
    players[0]?.id ??
    '';

  useEffect(() => {
    if (!currentTurnPlayerId || rawState?.roundWinnerPlayerId || rawState?.winningTeamId) return;
    const turnStartedAt = Date.parse(rawState?.turnStartedAt ?? rawState?.updated_at ?? '');
    const updateTimer = () => {
      const elapsed = Number.isFinite(turnStartedAt)
        ? Math.floor((Date.now() - turnStartedAt) / 1000)
        : 0;
      setTurnTimeLeft(Math.max(0, PLAYER_TURN_DURATION_SECONDS - elapsed));
    };
    updateTimer();
    const timer = setInterval(updateTimer, 250);
    return () => clearInterval(timer);
  }, [currentTurnPlayerId, rawState?.turnStartedAt, rawState?.updated_at, rawState?.roundWinnerPlayerId, rawState?.winningTeamId]);

  useEffect(() => {
    if (!roomId || loading) return;
    if (!currentTurnPlayerId || rawState?.winningTeamId || rawState?.roundWinnerPlayerId) return;

    const currentTurnPlayer = playersRows.find(
      (row) => row.user_id === currentTurnPlayerId,
    );

    if (
      !currentTurnPlayer?.bot_takeover ||
      currentTurnPlayer.connected ||
      currentTurnPlayer.abandoned
    ) {
      return;
    }

    if (botTurnInFlightRef.current) return;
    botTurnInFlightRef.current = true;

    void supabase.functions
      .invoke('process_bot_turns', {
        body: {
          mode: '2v2',
          room_id: roomId,
        },
      })
      .then(({ error }) => {
        if (error) {
          console.warn('process_bot_turns 2v2 failed', error);
        }
      })
      .finally(() => {
        botTurnInFlightRef.current = false;
      });
  }, [
    roomId,
    loading,
    currentTurnPlayerId,
    rawState?.winningTeamId,
    rawState?.roundWinnerPlayerId,
    playersRows,
  ]);

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

  useEffect(() => {
    if (!roomId) return;

    const hasHands = Array.isArray(rawState?.handCounts) && rawState.handCounts.length > 0;
    if (hasHands) return;
    if (playersRows.length === 0) return;

    const timeout = setTimeout(async () => {
      const { data, error } = await supabase.rpc('get_two_vs_two_snapshot', {
        p_room_id: roomId,
      });

      if (error || !data) return;

      applySnapshot(data);
    }, 700);

    return () => clearTimeout(timeout);
  }, [roomId, rawState?.handCounts, playersRows.length, applySnapshot]);

  const playTile = async (tile: DominoTileData, branch?: KozelBranch) => {
    if (!roomId) throw new Error('No 2v2 room id');
    if (pendingMoveRef.current) return false;

    const resolvedBranch = branch ?? availableBranchesForTile(tile)[0];
    if (!resolvedBranch) return false;

    const pending: PendingMultiplayerMove = {
      requestId: `${roomId}:${tile.id}:${Date.now()}`,
      roomId,
      tile,
      branch: resolvedBranch,
      baseVersion: latestVersionRef.current,
      visualBoard: applyMove(
        board,
        tile,
        resolvedBranch,
        rawState?.spinnerValue ?? null,
        isOpeningRound,
      ).board,
    };
    pendingMoveRef.current = pending;
    setPendingMove(pending);

    try {
      const result = await submitTwoVsTwoMove(roomId, tile, resolvedBranch);
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

    return runMultiplayerAction({
      action: () => submitTwoVsTwoPass(roomId),
      onSuccess: (result) => !!result?.ok,
      errorLabel: 'submit_two_vs_two action=pass failed',
    });
  };

  useEffect(() => {
    if (!roomId || turnTimeLeft > 0 || rawState?.roundWinnerPlayerId || rawState?.winningTeamId) return;
    if (timeoutPassInFlightRef.current) return;
    timeoutPassInFlightRef.current = true;
    void submitTwoVsTwoPass(roomId, true)
      .then((result) => {
        if (!result?.ok) return;
        if (
          result.state?.myHandOwnerId &&
          result.state.myHandOwnerId !== currentUserId
        ) {
          console.warn('Ignored 2v2 timeout response with mismatched hand owner');
        }
        return refreshSnapshot();
      })
      .catch(() => refreshSnapshot().catch(() => undefined))
      .finally(() => {
        timeoutPassInFlightRef.current = false;
      });
  }, [roomId, turnTimeLeft, currentTurnPlayerId, currentUserId, rawState?.roundWinnerPlayerId, rawState?.winningTeamId, refreshSnapshot]);

  const startNextRound = useCallback(async () => {
    if (!roomId) return;
    try {
      await supabase.rpc('start_two_vs_two_game', { p_room_id: roomId });
    } catch (err) {
      console.warn('start_two_vs_two_game failed', err);
    }
  }, [roomId]);

  const createRoundResult = useCallback((winnerId: string) => {
    const snapshotHands = rawState?.debugPrivateHandsRaw ?? rawState?.privateHands ?? [];
    const winnerTeam = playersRows.find(
      (row) => (row.user_id ?? `bot-${row.id}`) === winnerId,
    )?.team_id;
    return buildRoundResult({
      winnerId,
      winnerTeam,
      awardedPoints: rawState?.lastScoringEvent?.points ?? 0,
      players: playersRows.map((row) => ({
        id: row.user_id ?? `bot-${row.id}`,
        playerIndex: typeof row.player_index === 'number' ? row.player_index : -1,
      })),
      hands: Array.isArray(snapshotHands) ? snapshotHands : [],
    });
  }, [playersRows, rawState]);

  const { phase, roundResult, nextRoundCountdown } = useRoundLifecycle({
    roundWinnerPlayerId: rawState?.roundWinnerPlayerId ?? null,
    winningTeamId: rawState?.winningTeamId ?? null,
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
    nextRoundCountdown,

    rawState,
    pendingMove,
  };
}
