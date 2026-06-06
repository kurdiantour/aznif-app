import { canHandMove, createEmptyBoard, getPlayableBranches } from '@/lib/game/kozel-engine';
import {
  submitOneVsOneDraw,
  submitOneVsOneMove,
  submitOneVsOnePass,
} from '@/lib/multiplayer/multiplayerApi';
import { supabase } from '@/lib/supabase';
import type {
    DominoTileData,
    KozelBoardState,
    KozelBranch,
    MatchReward,
    RoundPhase, RoundResult,
    ScoringEvent,
    TeamId,
} from '@/types/game';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MockGameState } from './useGameBase';

type UseOneVsOneResult = Omit<MockGameState, 'playTile' | 'drawTile' | 'passTurn'> & {
  loading: boolean;
  error: string | null;
  rawState: any;
  myPlayerIndex: number;
  opponentPlayerIndex: number;
  currentUserId: string | null;
  playTile: (tile: DominoTileData, branch?: KozelBranch) => Promise<any>;
  drawTile: () => Promise<boolean>;
  passTurn: () => Promise<boolean>;
};

function getDisplaySeat(playerIndex: number, myPlayerIndex: number): 'bottom' | 'top' {
  return playerIndex === myPlayerIndex ? 'bottom' : 'top';
}

export function useOneVsOneGame(roomId?: string): UseOneVsOneResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawState, setRawState] = useState<any>(null);
  const [playersRows, setPlayersRows] = useState<any[]>([]);
  const [profileById, setProfileById] = useState<Map<string, any>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const roomChannelRef = useRef<any>(null);
  const playersChannelRef = useRef<any>(null);
  const movesChannelRef = useRef<any>(null);
  const privateStateChannelRef = useRef<any>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const startGameInFlightRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const nextRoundScheduledRef = useRef(false);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<RoundPhase>('playing');
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [nextRoundCountdown, setNextRoundCountdown] = useState<number>(5);

  const applySnapshot = useCallback((snapshot: any) => {
    const nextRawState = {
      ...(snapshot ?? {}),
      ...(snapshot?.state ?? {}),
      mode: '1v1',
      currentTurnPlayerId: snapshot?.state?.currentTurnPlayerId ?? null,
    };

    setRawState(nextRawState);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!roomId) throw new Error('No 1v1 room id');

    const { data, error } = await supabase.rpc('get_one_vs_one_snapshot', {
      p_room_id: roomId,
    });

    if (error) throw error;

    applySnapshot(data);
    return data;
  }, [roomId, applySnapshot]);

  const applySuccessfulAction = useCallback(async (result: any) => {
    if (!result?.ok) return false;

    applySnapshot({
      ...(result.room ?? {}),
      state: result.state ?? result.room?.state ?? {},
    });
    await refreshSnapshot();
    return true;
  }, [applySnapshot, refreshSnapshot]);

  useEffect(() => {
    if (!roomId) {
      setError('No 1v1 room id');
      setLoading(false);
      return;
    }

    let mounted = true;

    const loadRoom = async () => {
      const data = await refreshSnapshot();
      if (!mounted) return;

      const hasStarted =
        data?.state?.status === 'started' || Array.isArray(data?.state?.handCounts);

      if (
        !hasStarted &&
        (data?.status === 'waiting' || data?.status === 'active') &&
        !startGameInFlightRef.current
      ) {
        startGameInFlightRef.current = true;

        try {
          const { error: startError } = await supabase.rpc('start_one_vs_one_game', {
            p_room_id: roomId,
          });

          if (startError) throw startError;
          if (!mounted) return;

          const { data: startedSnapshot, error: snapshotError } = await supabase.rpc(
            'get_one_vs_one_snapshot',
            { p_room_id: roomId },
          );

          if (snapshotError) throw snapshotError;
          if (!mounted) return;

          applySnapshot(startedSnapshot);
        } finally {
          startGameInFlightRef.current = false;
        }
      }
    };

    const loadPlayers = async () => {
      const { data, error } = await supabase
        .from('one_vs_one_players')
        .select('id, user_id, player_index, seat, team_id, kind')
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
        currentUserIdRef.current = userResp.data.user?.id ?? null;

        if (userResp.data.user?.id) {
          await supabase.rpc('restore_one_vs_one_human_control', {
            p_room_id: roomId,
          });
        }

        await Promise.all([loadRoom(), loadPlayers()]);

        roomChannelRef.current = supabase
          .channel(`one_vs_one_rooms:${roomId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'one_vs_one_rooms',
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
          .channel(`one_vs_one_players:${roomId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'one_vs_one_players',
              filter: `room_id=eq.${roomId}`,
            },
            () => void loadPlayers(),
          )
          .subscribe((status, err) => {
            if (!mounted) return;
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setError(err?.message ?? 'Realtime player sync failed');
            }
          });

        movesChannelRef.current = supabase
          .channel(`one_vs_one_moves:${roomId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'one_vs_one_moves',
              filter: `room_id=eq.${roomId}`,
            },
            () => {
              if (!mounted) return;
              void loadRoom();
            },
          )
          .subscribe((status, err) => {
            if (!mounted) return;
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setError(err?.message ?? 'Realtime move sync failed');
            }
          });

        privateStateChannelRef.current = supabase
          .channel(`one_vs_one_private_states:${roomId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'one_vs_one_private_states',
              filter: `room_id=eq.${roomId}`,
            },
            () => {
              if (!mounted) return;
              void loadRoom();
            },
          )
          .subscribe((status, err) => {
            if (!mounted) return;
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setError(err?.message ?? 'Realtime private state sync failed');
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

      if (movesChannelRef.current) {
        void supabase.removeChannel(movesChannelRef.current);
        movesChannelRef.current = null;
      }

      if (privateStateChannelRef.current) {
        void supabase.removeChannel(privateStateChannelRef.current);
        privateStateChannelRef.current = null;
      }
    };
  }, [roomId, applySnapshot, refreshSnapshot]);

  useEffect(() => {
    if (!roomId || rawState?.winningTeamId || rawState?.status === 'finished') return;

    const pollSnapshot = async () => {
      if (pollInFlightRef.current) return;

      pollInFlightRef.current = true;
      try {
        await refreshSnapshot();
      } catch (err) {
        console.warn('1v1 snapshot polling failed', err);
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const interval = setInterval(() => {
      void pollSnapshot();
    }, 1000);

    return () => {
      clearInterval(interval);
      pollInFlightRef.current = false;
    };
  }, [roomId, rawState?.status, rawState?.winningTeamId, refreshSnapshot]);

  useEffect(() => {
    // listen for round finish coming from server snapshot
    const winnerId = rawState?.roundWinnerPlayerId ?? null;
    if (!winnerId || rawState?.winningTeamId) {
      if (!winnerId) {
        nextRoundScheduledRef.current = false;
      }
      return;
    }

    if (playersRows.length < 2) return;

    if (nextRoundScheduledRef.current) return;
    nextRoundScheduledRef.current = true;

    // build remaining tiles if snapshot contains debugPrivateHandsRaw
    const remainingTilesByPlayer: Record<string, any[]> = {};
    const remainingPipsByPlayer: Record<string, number> = {};

    const snapshotHands = rawState?.debugPrivateHandsRaw ?? rawState?.privateHands ?? null;

    playersRows.forEach((row) => {
      const playerId = row.user_id ?? `bot-${row.id}`;
      const playerIndex = row.player_index;
      const tiles =
        Array.isArray(snapshotHands) && typeof playerIndex === 'number'
          ? snapshotHands[playerIndex] ?? []
          : [];
      remainingTilesByPlayer[playerId] = tiles.map((t: any) => ({ ...t }));
      remainingPipsByPlayer[playerId] = tiles.reduce((s: number, t: any) => s + (t.left ?? 0) + (t.right ?? 0), 0);
    });

    const winnerTeam = playersRows.find((row) => (row.user_id ?? `bot-${row.id}`) === winnerId)?.team_id;
    const awardedPoints = rawState?.lastScoringEvent?.points ?? 0;

    setRoundResult({
      winnerId,
      winnerTeam,
      awardedPoints,
      remainingTilesByPlayer,
      remainingPipsByPlayer,
    });

    setPhase('round_result_reveal');

    // central timer: reveal -> countdown -> start next round via RPC
    if (phaseTimerRef.current) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }

    phaseTimerRef.current = setTimeout(() => {
      setPhase('next_round_countdown');
      setNextRoundCountdown(5);

      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }

      countdownIntervalRef.current = setInterval(() => {
        setNextRoundCountdown((prev) => {
          if (prev <= 1) {
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
            }

            // call server to start next round
            startNextRound();
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
  }, [rawState?.roundWinnerPlayerId, rawState?.winningTeamId, rawState?.lastScoringEvent, rawState?.debugPrivateHandsRaw, rawState?.privateHands, playersRows]);

  const startNextRound = async () => {
    if (!roomId) return;
    setPhase('dealing');
    try {
      await supabase.rpc('start_one_vs_one_game', { p_room_id: roomId });
    } catch (err) {
      console.warn('start_one_vs_one_game failed', err);
    } finally {
      nextRoundScheduledRef.current = false;
      setRoundResult(null);
      setNextRoundCountdown(5);
      setPhase('playing');
    }
  };

  const myPlayerIndex = useMemo(() => {
    if (!currentUserId) return -1;
    const myRow = playersRows.find((playerRow) => playerRow.user_id === currentUserId);
    return typeof myRow?.player_index === 'number' ? myRow.player_index : -1;
  }, [playersRows, currentUserId]);

  const opponentPlayerIndex = useMemo(() => {
    if (!currentUserId) return -1;
    const opponentRow = playersRows.find((playerRow) => playerRow.user_id !== currentUserId);
    return typeof opponentRow?.player_index === 'number' ? opponentRow.player_index : -1;
  }, [playersRows, currentUserId]);

  const players = useMemo(() => {
    const state = rawState ?? {};
    const handCounts = state.handCounts ?? [];

    return playersRows.map((row) => {
      const playerId = row.user_id ?? `bot-${row.id}`;
      const profile = row.user_id ? profileById.get(row.user_id) : null;
      const playerIndex =
        typeof row.player_index === 'number' ? row.player_index : 0;

      return {
        id: playerId,
        name: profile?.username ?? (row.user_id ? 'Player' : 'Bot'),
        seat: getDisplaySeat(playerIndex, myPlayerIndex),
        kind: row.kind,
        teamId: row.team_id,
        isActive: playerId === state.currentTurnPlayerId,
        timeLeft: 10,
        tileCount: handCounts[playerIndex] ?? 0,
        score: state.teamScores?.[row.team_id] ?? 0,
        isLeader: state.leaderPlayerId ? playerId === state.leaderPlayerId : false,
        avatarId: profile?.avatar_id,
      };
    });
  }, [playersRows, profileById, rawState, myPlayerIndex]);

  const board: KozelBoardState = rawState?.board ?? createEmptyBoard();

  const currentTurnPlayerId = rawState?.currentTurnPlayerId ?? '';

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

  useEffect(() => {
    if (!roomId || loading) return;

    console.log('[1v1 frontend identity]', {
      roomId,
      currentUserId,
      gameCurrentTurnPlayerId: currentTurnPlayerId,
      myPlayerIndex,
      opponentPlayerIndex,
      snapshotMyPlayerIndex: rawState?.myPlayerIndex ?? null,
      roomCurrentTurnPlayerId: rawState?.current_turn_player_id ?? null,
      stateCurrentTurnPlayerId: rawState?.state?.currentTurnPlayerId ?? rawState?.currentTurnPlayerId ?? null,
      myHandIds: myHand.map((tile) => tile.id),
      players: playersRows.map((row) => ({
        user_id: row.user_id,
        player_index: row.player_index,
        seat: row.seat,
        team_id: row.team_id,
      })),
    });
  }, [roomId, loading, currentUserId, currentTurnPlayerId, myPlayerIndex, opponentPlayerIndex, rawState, myHand, playersRows]);

  useEffect(() => {
    if (!roomId || loading) return;
    if (!rawState) return;
    if (myHand.length > 0) return;

    const expectedHandCount = Number(rawState.handCounts?.[myPlayerIndex] ?? 0);

    if (expectedHandCount <= 0) return;

    const retry = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('get_one_vs_one_snapshot', {
          p_room_id: roomId,
        });

        if (error) throw error;

        const nextRawState = {
          ...(data ?? {}),
          ...(data?.state ?? {}),
          mode: '1v1',
          currentTurnPlayerId: data?.state?.currentTurnPlayerId ?? null,
        };

        console.log('[1v1 snapshot retry]', {
          roomId,
          frontendUserId: currentUserIdRef.current,
          debugRpcVersion: data?.debugRpcVersion,
          debugAuthUserId: data?.debugAuthUserId,
          debugDbCurrentUser: data?.debugDbCurrentUser,
          debugDbSessionUser: data?.debugDbSessionUser,
          myPlayerIndex: data?.myPlayerIndex,
          debugPlayerIndex: data?.debugPlayerIndex,
          debugRoomStatus: data?.debugRoomStatus,
          debugPrivateStateFound: data?.debugPrivateStateFound,
          debugPrivateRoomId: data?.debugPrivateRoomId,
          debugPrivateHandsRaw: data?.debugPrivateHandsRaw,
          debugHandsLength: data?.debugHandsLength,
          debugSelectedHandLength: data?.debugSelectedHandLength,
          flattenedMyHandLength: Array.isArray(nextRawState.myHand)
            ? nextRawState.myHand.length
            : null,
        });

        setRawState(nextRawState);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    }, 350);

    return () => {
      clearTimeout(retry);
    };
  }, [roomId, loading, rawState, myHand.length, myPlayerIndex]);

  const openingDouble =
    typeof rawState?.openingDouble === 'number' ? rawState.openingDouble : null;

  const isOpeningRound = Boolean(
    rawState?.isOpeningRound ?? rawState?.isFirstRound ?? true,
  );

  const availableBranchesForTile = (tile: DominoTileData): KozelBranch[] => {
    try {
      return getPlayableBranches(
        tile,
        board,
        rawState?.spinnerValue ?? null,
        isOpeningRound,
        openingDouble,
      ) as KozelBranch[];
    } catch {
      return [];
    }
  };

  const hasPlayableTile = useMemo(() => {
    try {
      return canHandMove(
        myHand,
        board,
        rawState?.spinnerValue ?? null,
        isOpeningRound,
        openingDouble,
      );
    } catch {
      return false;
    }
  }, [myHand, board, rawState, isOpeningRound, openingDouble]);

  const playTile = async (tile: DominoTileData, branch?: KozelBranch) => {
    if (!roomId) throw new Error('No 1v1 room id');
    const tileInMyHand = myHand.some((handTile) => handTile.id === tile.id);

    console.log('[1v1 playTile]', {
      roomId,
      currentUserId,
      gameCurrentTurnPlayerId: currentTurnPlayerId,
      myPlayerIndex,
      opponentPlayerIndex,
      tileId: tile?.id ?? null,
      tileInMyHand,
      myHandIds: myHand.map((handTile) => handTile.id),
    });

    if (!tileInMyHand) {
      console.warn('[1v1 playTile blocked: tile not in myHand]', {
        roomId,
        currentUserId,
        myPlayerIndex,
        opponentPlayerIndex,
        tileId: tile?.id ?? null,
        myHandIds: myHand.map((handTile) => handTile.id),
      });

      return false;
    }

    const result = await submitOneVsOneMove(roomId, tile, branch);

    await applySuccessfulAction(result);

    return result;
  };

  const drawTile = async () => {
    if (!roomId) return false;

    try {
      const result = await submitOneVsOneDraw(roomId);
      return applySuccessfulAction(result);
    } catch (err) {
      console.warn('submit_one_vs_one action=draw failed', err);
      return false;
    }
  };

  const passTurn = async () => {
    if (!roomId) return false;

    try {
      const result = await submitOneVsOnePass(roomId);
      return applySuccessfulAction(result);
    } catch (err) {
      console.warn('submit_one_vs_one action=pass failed', err);
      return false;
    }
  };

  return {
    loading,
    error,

    players,
    currentTurnPlayerId,
    board,
    myHand,
    boneyardCount: rawState?.boneyardCount ?? 0,
    mode: '1v1',

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

    canDrawTile:
  !!currentUserId &&
  currentTurnPlayerId === currentUserId &&
  !hasPlayableTile &&
  (rawState?.boneyardCount ?? 0) > 0 &&
  !rawState?.roundWinnerPlayerId &&
  !rawState?.winningTeamId,
    hasPlayableTile,
    lastPassedPlayerId: rawState?.lastPassedPlayerId ?? null,

    rawState,
    myPlayerIndex,
    opponentPlayerIndex,
    currentUserId,
    phase,
    roundResult,
    nextRoundCountdown,
  };
}
