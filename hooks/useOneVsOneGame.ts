import { applyMove, createEmptyBoard } from '@/lib/game/kozel-engine';
import {
  MultiplayerRequestError,
  submitOneVsOneDraw,
  submitOneVsOneMove,
  submitOneVsOnePass,
  type DrawTimeoutClaim,
  type TurnTimeoutClaim,
} from '@/lib/multiplayer/multiplayerApi';
import {
  boardContainsMove,
  getSnapshotVersion,
  type PendingMultiplayerMove,
} from '@/lib/multiplayer/optimisticMove';
import { calculateLevelFromPoints } from '@/lib/progression';
import { supabase } from '@/lib/supabase';
import type {
  DominoTileData,
  KozelBoardState,
  KozelBranch,
  MatchReward,
  ScoringEvent,
  TeamId,
} from '@/types/game';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getAvailableBranches, handContainsTile, handHasPlayableTile } from './gameRuleQueries';
import {
  MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN,
  PLAYER_TURN_DURATION_SECONDS,
  ROUND_TRANSITION_SYNC_MS,
} from './gameShared';
import { runMultiplayerAction } from './multiplayerAction';
import { getPlayerIndex, getRelativeSeat } from './multiplayerPlayerNormalization';
import { buildRoundResult } from './roundResult';
import type { MockGameState } from './useGameBase';
import { useRoundLifecycle } from './useRoundLifecycle';

type UseOneVsOneResult = Omit<MockGameState, 'playTile' | 'drawTile' | 'passTurn'> & {
  loading: boolean;
  error: string | null;
  rawState: any;
  myPlayerIndex: number;
  opponentPlayerIndex: number;
  currentUserId: string | null;
  drawTimeLeft: number;
  pendingMove: PendingMultiplayerMove | null;
  playTile: (tile: DominoTileData, branch?: KozelBranch) => Promise<any>;
  drawTile: () => Promise<boolean>;
  passTurn: () => Promise<boolean>;
};

const DRAW_PHASE_DURATION_SECONDS = 5;

export function useOneVsOneGame(roomId?: string): UseOneVsOneResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawState, setRawState] = useState<any>(null);
  const [playersRows, setPlayersRows] = useState<any[]>([]);
  const [profileById, setProfileById] = useState<Map<string, any>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [turnTimeLeft, setTurnTimeLeft] = useState(PLAYER_TURN_DURATION_SECONDS);
  const [drawTimeLeft, setDrawTimeLeft] = useState(DRAW_PHASE_DURATION_SECONDS);
  const [pendingMove, setPendingMove] = useState<PendingMultiplayerMove | null>(null);

  const roomChannelRef = useRef<any>(null);
  const playersChannelRef = useRef<any>(null);
  const movesChannelRef = useRef<any>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const startGameInFlightRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const botTurnInFlightRef = useRef(false);
  const takeoverWatchdogInFlightRef = useRef(false);
  const roundTransitionSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roundTransitionStartedAtRef = useRef<number | null>(null);
  const latestVersionRef = useRef(-1);
  const pendingMoveRef = useRef<PendingMultiplayerMove | null>(null);
  const timeoutPassInFlightRef = useRef(false);
  const timeoutRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRetryTurnKeyRef = useRef<string | null>(null);
  const activeTurnKeyRef = useRef<string | null>(null);
  const serverClockOffsetMsRef = useRef(0);
  const roomIdRef = useRef(roomId);
  const timeoutSubmitRef = useRef<((claim: TurnTimeoutClaim, turnKey: string, claimRoomId: string) => void) | null>(null);
  const drawTimeoutInFlightRef = useRef(false);
  const drawTimeoutRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeDrawKeyRef = useRef<string | null>(null);
  const drawTimeoutSubmitRef = useRef<((claim: DrawTimeoutClaim, drawKey: string, claimRoomId: string) => void) | null>(null);
  const lastRealtimeActivityRef = useRef<number>(Date.now());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef<number>(0);

  const clearTimeoutRetry = useCallback(() => {
    if (timeoutRetryRef.current) {
      clearTimeout(timeoutRetryRef.current);
      timeoutRetryRef.current = null;
    }
    timeoutRetryTurnKeyRef.current = null;
  }, []);

  const clearDrawTimeoutRetry = useCallback(() => {
    if (drawTimeoutRetryRef.current) {
      clearTimeout(drawTimeoutRetryRef.current);
      drawTimeoutRetryRef.current = null;
    }
  }, []);

  useEffect(() => {
    roomIdRef.current = roomId;
    latestVersionRef.current = -1;
    pendingMoveRef.current = null;
    activeTurnKeyRef.current = null;
    activeDrawKeyRef.current = null;
    timeoutPassInFlightRef.current = false;
    drawTimeoutInFlightRef.current = false;
    clearTimeoutRetry();
    clearDrawTimeoutRetry();
    setPendingMove(null);

    return () => {
      activeTurnKeyRef.current = null;
      activeDrawKeyRef.current = null;
      timeoutPassInFlightRef.current = false;
      drawTimeoutInFlightRef.current = false;
      clearTimeoutRetry();
      clearDrawTimeoutRetry();
    };
  }, [roomId, clearTimeoutRetry, clearDrawTimeoutRetry]);

  const applySnapshot = useCallback((snapshot: any) => {
    const version = getSnapshotVersion(snapshot);
    if (version >= 0 && version < latestVersionRef.current) return false;
    if (version >= 0) latestVersionRef.current = version;

    const nextRawState = {
      ...(snapshot ?? {}),
      ...(snapshot?.state ?? {}),
      mode: '1v1',
      currentTurnPlayerId:
        snapshot?.state?.currentTurnPlayerId ??
        snapshot?.current_turn_player_id ??
        null,
    };

    const turnStartedAt = nextRawState.turnStartedAt ?? nextRawState.updated_at ?? null;
    const currentTurnPlayerId = nextRawState.currentTurnPlayerId ?? null;
    activeTurnKeyRef.current =
      version >= 0 && typeof turnStartedAt === 'string' && typeof currentTurnPlayerId === 'string'
        ? `${version}:${turnStartedAt}:${currentTurnPlayerId}`
        : null;
    const drawStartedAt = nextRawState.drawStartedAt ?? null;
    activeDrawKeyRef.current =
      nextRawState.canDrawTile === true &&
      version >= 0 &&
      typeof drawStartedAt === 'string' &&
      typeof currentTurnPlayerId === 'string'
        ? `${version}:${drawStartedAt}:${currentTurnPlayerId}`
        : null;
    clearTimeoutRetry();
    clearDrawTimeoutRetry();
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
  }, [clearTimeoutRetry, clearDrawTimeoutRetry]);

  const refreshSnapshot = useCallback(async () => {
    if (!roomId) throw new Error('No 1v1 room id');

    const { data, error } = await supabase.rpc('get_one_vs_one_snapshot', {
      p_room_id: roomId,
    });

    if (error) throw error;

    applySnapshot(data);
    return data;
  }, [roomId, applySnapshot]);

  const refreshPlayers = useCallback(async (includeProfiles = true) => {
    if (!roomId) throw new Error('No 1v1 room id');

    const { data, error } = await supabase
      .from('one_vs_one_players')
      .select('id, user_id, player_index, seat, team_id, kind, connected, bot_takeover, abandoned')
      .eq('room_id', roomId)
      .order('player_index', { ascending: true });

    if (error) throw error;

    const rows = data ?? [];
    setPlayersRows(rows);

    if (!includeProfiles) return rows;

    const userIds = rows.map((row: any) => row.user_id).filter(Boolean);
    if (!userIds.length) {
      setProfileById(new Map());
      return rows;
    }

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, username, avatar_id, points')
      .in('id', userIds);

    if (profilesError) throw profilesError;
    setProfileById(new Map((profiles ?? []).map((profile: any) => [profile.id, profile])));
    return rows;
  }, [roomId]);

  const applySuccessfulAction = useCallback(async (result: any) => {
    if (!result?.ok) return false;

    const actionSnapshot = {
      ...(result.room ?? {}),
      state: result.state ?? result.room?.state ?? {},
    };

    applySnapshot(actionSnapshot);
    setError(null);


    return true;
  }, [applySnapshot]);

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

        await Promise.all([loadRoom(), refreshPlayers()]);

        const markRealtimeActivity = () => {
          lastRealtimeActivityRef.current = Date.now();
        };

        const handleChannelStatus = (channelName: string, status: string, err?: any) => {
          if (!mounted) return;
          if (status === 'SUBSCRIBED') {
            reconnectAttemptRef.current = 0;
            markRealtimeActivity();
            setError(null);
            void loadRoom();
            void refreshPlayers();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`1v1 Realtime ${channelName} status: ${status}`, err);
            const backoffDelay = Math.min(
              1000 * Math.pow(2, reconnectAttemptRef.current),
              15000,
            );
            reconnectAttemptRef.current += 1;

            if (!reconnectTimerRef.current && mounted && roomId) {
              reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                if (!mounted) return;
                subscribeChannels();
              }, backoffDelay);
            }
          }
        };

        const subscribeChannels = () => {
          if (roomChannelRef.current) void supabase.removeChannel(roomChannelRef.current);
          if (playersChannelRef.current) void supabase.removeChannel(playersChannelRef.current);
          if (movesChannelRef.current) void supabase.removeChannel(movesChannelRef.current);

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
    (payload) => {
      if (!mounted) return;

      markRealtimeActivity();

const updatedRoom = payload.new as any;

if (updatedRoom) {
  const publicState = updatedRoom.state ?? {};
  const version = getSnapshotVersion(updatedRoom);

  if (version >= 0 && version < latestVersionRef.current) {
    return;
  }

  if (version >= 0) {
    latestVersionRef.current = version;
  }

  setRawState((previousState: any) => {
    const nextRawState = {
      ...(previousState ?? {}),
      ...updatedRoom,
      ...publicState,

      // Realtime room rows contain public game state only.
      // Keep this device's private hand from its authenticated snapshot.
      myHand: previousState?.myHand ?? [],

      mode: '1v1',

      currentTurnPlayerId:
        publicState.currentTurnPlayerId ??
        updatedRoom.current_turn_player_id ??
        previousState?.currentTurnPlayerId ??
        null,
    };

    const turnStartedAt =
      nextRawState.turnStartedAt ??
      nextRawState.updated_at ??
      null;

    const nextTurnPlayerId =
      nextRawState.currentTurnPlayerId ??
      null;

    activeTurnKeyRef.current =
      version >= 0 &&
      typeof turnStartedAt === 'string' &&
      typeof nextTurnPlayerId === 'string'
        ? `${version}:${turnStartedAt}:${nextTurnPlayerId}`
        : null;

    const drawStartedAt = nextRawState.drawStartedAt ?? null;
    activeDrawKeyRef.current =
      nextRawState.canDrawTile === true &&
      version >= 0 &&
      typeof drawStartedAt === 'string' &&
      typeof nextTurnPlayerId === 'string'
        ? `${version}:${drawStartedAt}:${nextTurnPlayerId}`
        : null;

    clearTimeoutRetry();
    clearDrawTimeoutRetry();

    return nextRawState;
  });

  // IMPORTANT: this must be OUTSIDE setRawState()
void refreshSnapshot().catch((error) => {
  console.warn(
    '1v1 private hand refresh after room realtime update failed',
    error,
  );
});

}
    },
  )
  .subscribe((status, err) => handleChannelStatus('rooms', status, err));

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
              () => {
                if (!mounted) return;
                markRealtimeActivity();
                void refreshPlayers();
              },
            )
            .subscribe((status, err) => handleChannelStatus('players', status, err));

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
    (payload) => {
      if (!mounted) return;

      markRealtimeActivity();

      if ((payload.new as any)?.action === 'manual_leave_takeover') {
        void refreshPlayers();
      }
    },
  )
            .subscribe((status, err) => handleChannelStatus('moves', status, err));
        };

        subscribeChannels();

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

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

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
    };
  }, [roomId, applySnapshot, refreshSnapshot, refreshPlayers]);

  useEffect(() => {
    if (!roomId) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void Promise.all([
          refreshSnapshot(),
          refreshPlayers(false),
        ])
          .then(() => {
            lastRealtimeActivityRef.current = Date.now();
          })
          .catch((err) => {
            console.warn('1v1 AppState reconcile failed', err);
          });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [roomId, refreshSnapshot, refreshPlayers]);

  useEffect(() => {
    if (!roomId || !currentUserId) return;

    const heartbeat = async () => {
      const { error } = await supabase.rpc('one_vs_one_player_heartbeat', {
        p_room_id: roomId,
      });
      if (error) console.warn('1v1 heartbeat failed', error);
    };

    void heartbeat();
    const interval = setInterval(() => void heartbeat(), 30_000);
    return () => clearInterval(interval);
  }, [roomId, currentUserId]);

  useEffect(() => {
    if (!roomId || loading || rawState?.winningTeamId) return;

    const runTakeoverWatchdog = async () => {
      if (takeoverWatchdogInFlightRef.current) return;
      takeoverWatchdogInFlightRef.current = true;
      try {
        const { data, error } = await supabase.functions.invoke(
          'process_bot_turns',
          { body: { mode: '1v1', room_id: roomId } },
        );
        if (error) throw error;
        if (data?.processed) {
          await Promise.all([refreshSnapshot(), refreshPlayers(false)]);
        }
      } catch (watchdogError) {
        console.warn('1v1 takeover watchdog failed', watchdogError);
      } finally {
        takeoverWatchdogInFlightRef.current = false;
      }
    };

    void runTakeoverWatchdog();
    const interval = setInterval(() => void runTakeoverWatchdog(), 10_000);
    return () => clearInterval(interval);
  }, [
    roomId,
    loading,
    rawState?.winningTeamId,
    refreshSnapshot,
    refreshPlayers,
  ]);

  useEffect(() => {
    if (
      !roomId ||
      loading ||
      rawState?.roundWinnerPlayerId ||
      rawState?.winningTeamId ||
      rawState?.status === 'finished'
    ) return;

    const pollFallbackWatchdog = async () => {
      if (pollInFlightRef.current) return;
      const silentMs = Date.now() - lastRealtimeActivityRef.current;
      if (silentMs < 12_000) return;

      pollInFlightRef.current = true;
      try {
        await Promise.all([refreshSnapshot(), refreshPlayers(false)]);
        lastRealtimeActivityRef.current = Date.now();
      } catch (err) {
        console.warn('1v1 snapshot fallback watchdog failed', err);
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const interval = setInterval(() => {
      void pollFallbackWatchdog();
    }, 5000);

    return () => {
      clearInterval(interval);
      pollInFlightRef.current = false;
    };
  }, [
    roomId,
    loading,
    rawState?.status,
    rawState?.roundWinnerPlayerId,
    rawState?.winningTeamId,
    refreshSnapshot,
    refreshPlayers,
  ]);

  const currentTurnPlayerId = rawState?.currentTurnPlayerId ?? '';
  const roundWinnerPlayerId = rawState?.roundWinnerPlayerId ?? null;
  const winningTeamId = rawState?.winningTeamId ?? null;

useEffect(() => {
  if (!currentTurnPlayerId || roundWinnerPlayerId || winningTeamId) return;

  // Drawing is a mandatory game action, not decision time.
  // Pause the visible countdown while the server says Draw is required.
  if (rawState?.canDrawTile === true) return;

  const turnStartedAt = Date.parse(
    rawState?.turnStartedAt ?? rawState?.updated_at ?? '',
  );


    const updateTimer = () => {
      const elapsed = Number.isFinite(turnStartedAt)
        ? Math.floor((Date.now() + serverClockOffsetMsRef.current - turnStartedAt) / 1000)
        : 0;
      setTurnTimeLeft(Math.max(0, PLAYER_TURN_DURATION_SECONDS - elapsed));
    };
    updateTimer();
    const timer = setInterval(updateTimer, 250);

    return () => clearInterval(timer);
}, [
  currentTurnPlayerId,
  rawState?.turnStartedAt,
  rawState?.updated_at,
  rawState?.canDrawTile,
  roundWinnerPlayerId,
  winningTeamId,
]);

  useEffect(() => {
    if (
      !currentTurnPlayerId ||
      roundWinnerPlayerId ||
      winningTeamId ||
      rawState?.canDrawTile !== true
    ) {
      setDrawTimeLeft(DRAW_PHASE_DURATION_SECONDS);
      return;
    }

    const drawStartedAt = Date.parse(rawState?.drawStartedAt ?? '');

    const updateDrawTimer = () => {
      const elapsed = Number.isFinite(drawStartedAt)
        ? Math.floor((Date.now() + serverClockOffsetMsRef.current - drawStartedAt) / 1000)
        : 0;
      setDrawTimeLeft(Math.max(0, DRAW_PHASE_DURATION_SECONDS - elapsed));
    };

    updateDrawTimer();
    const timer = setInterval(updateDrawTimer, 250);
    return () => clearInterval(timer);
  }, [
    currentTurnPlayerId,
    rawState?.canDrawTile,
    rawState?.drawStartedAt,
    roundWinnerPlayerId,
    winningTeamId,
  ]);
  const startNextRound = useCallback(async () => {
    if (!roomId) return;
    if (roundTransitionSyncRef.current) {
      clearInterval(roundTransitionSyncRef.current);
      roundTransitionSyncRef.current = null;
    }
    try {
      await supabase.rpc('start_one_vs_one_game', { p_room_id: roomId });
      await refreshSnapshot();
    } catch (err) {
      console.warn('start_one_vs_one_game failed', err);
    }
  }, [roomId, refreshSnapshot]);

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

    const finishBotTurn = async () => {
      try {
        // A 1v1 bot may need to draw several times before it can play or pass.
        // Keep processing in this invocation cycle until control leaves the bot
        // or the current round ends, rather than waiting for a turn-id change.
        for (let actionCount = 0; actionCount < 5; actionCount += 1) {
          const { data, error } = await supabase.functions.invoke(
            'process_bot_turns',
            {
              body: {
                mode: '1v1',
                room_id: roomId,
              },
            },
          );

          if (error) throw error;
          if (!data?.processed) break;

          const nextState = data.state ?? {};
          if (
            nextState.roundWinnerPlayerId ||
            nextState.winningTeamId ||
            nextState.currentTurnPlayerId !== currentTurnPlayerId
          ) {
            break;
          }
        }
      } catch (error) {
        console.warn('process_bot_turns 1v1 failed', error);
      } finally {
        botTurnInFlightRef.current = false;
        void refreshSnapshot().catch((error) => {
          console.warn('1v1 bot turn refresh failed', error);
        });
      }
    };

    void finishBotTurn();
  }, [
    roomId,
    loading,
    currentTurnPlayerId,
    rawState?.winningTeamId,
    rawState?.roundWinnerPlayerId,
    playersRows,
    refreshSnapshot,
  ]);

  const createRoundResult = useCallback((winnerId: string) => {
    if (playersRows.length < 2) return null;
    const winnerTeam = playersRows.find(
      (row) => (row.user_id ?? `bot-${row.id}`) === winnerId,
    )?.team_id;
    const players = playersRows.map((row) => ({
      id: row.user_id ?? `bot-${row.id}`,
      playerIndex: typeof row.player_index === 'number' ? row.player_index : -1,
    }));
    const awardedPoints = rawState?.endOfHandScoringEvent?.points ?? 0;

    if (
      !Array.isArray(rawState?.revealedFinalHands) ||
      rawState.revealedFinalHands.length < 2
    ) {
      return null;
    }

    return buildRoundResult({
      winnerId,
      winnerTeam,
      awardedPoints,
      players,
      hands: rawState.revealedFinalHands,
    });
  }, [playersRows, rawState]);

  const { phase, roundResult, nextRoundCountdown, resetRoundPresentation } =
    useRoundLifecycle({
      roundWinnerPlayerId,
      winningTeamId,
      buildRoundResult: createRoundResult,
      startNextRound,
    });

  useEffect(() => {
    if (!roundWinnerPlayerId || winningTeamId || rawState?.status === 'finished') {
      if (roundTransitionSyncRef.current) clearInterval(roundTransitionSyncRef.current);
      roundTransitionSyncRef.current = null;
      roundTransitionStartedAtRef.current = null;
      return;
    }

    roundTransitionStartedAtRef.current = Date.now();
    roundTransitionSyncRef.current = setInterval(() => {
      void refreshSnapshot().catch((error) => {
        console.warn('1v1 round transition sync failed', error);
      });
    }, ROUND_TRANSITION_SYNC_MS);

    return () => {
      if (roundTransitionSyncRef.current) clearInterval(roundTransitionSyncRef.current);
      roundTransitionSyncRef.current = null;
      roundTransitionStartedAtRef.current = null;
    };
  }, [refreshSnapshot, rawState?.status, roundWinnerPlayerId, winningTeamId]);

  const myPlayerIndex = useMemo(() => {
    if (!currentUserId) return -1;
    return getPlayerIndex(playersRows, (row) => row.user_id === currentUserId);
  }, [playersRows, currentUserId]);

  const opponentPlayerIndex = useMemo(() => {
    if (!currentUserId) return -1;
    return getPlayerIndex(playersRows, (row) => row.user_id !== currentUserId);
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
        name: row.bot_takeover
          ? 'رۆبوتی کاتی'
          : profile?.username ?? (row.user_id ? 'Player' : 'Bot'),
        seat: getRelativeSeat(playerIndex, myPlayerIndex, 2),
        kind: row.kind,
        teamId: row.team_id,
        isActive: playerId === state.currentTurnPlayerId,
timeLeft:
  playerId === state.currentTurnPlayerId
    ? turnTimeLeft
    : PLAYER_TURN_DURATION_SECONDS,
        tileCount: handCounts[playerIndex] ?? 0,
        score: state.teamScores?.[row.team_id] ?? 0,
        isLeader: state.leaderPlayerId ? playerId === state.leaderPlayerId : false,
        avatarId: profile?.avatar_id,
        level: calculateLevelFromPoints(profile?.points),
        points: profile?.points,
      };
    });
  }, [playersRows, profileById, rawState, myPlayerIndex, turnTimeLeft, drawTimeLeft]);

  const board: KozelBoardState = rawState?.board ?? createEmptyBoard();

  const teamScores: Record<TeamId, number> = {
    teamA: rawState?.teamScores?.teamA ?? 0,
    teamB: rawState?.teamScores?.teamB ?? 0,
  };

  const myHand: DominoTileData[] = useMemo(() => {
    return rawState?.myHand ?? [];
  }, [rawState]);

  useEffect(() => {
    const hasAuthoritativeActiveHand =
      rawState?.status === 'started' &&
      !rawState?.roundWinnerPlayerId &&
      !rawState?.winningTeamId &&
      !!rawState?.currentTurnPlayerId &&
      myHand.length > 0;

    if (!hasAuthoritativeActiveHand) return;

    if (roundTransitionSyncRef.current) {
      clearInterval(roundTransitionSyncRef.current);
      roundTransitionSyncRef.current = null;
    }

    roundTransitionStartedAtRef.current = null;
    resetRoundPresentation();
  }, [
    rawState?.status,
    rawState?.roundWinnerPlayerId,
    rawState?.winningTeamId,
    rawState?.currentTurnPlayerId,
    myHand.length,
    resetRoundPresentation,
  ]);

  useEffect(() => {
    if (!roomId || loading) return;
    if (!rawState) return;
    if (
      rawState?.roundWinnerPlayerId ||
      rawState?.winningTeamId ||
      rawState?.status === 'finished'
    ) return;
    if (myHand.length > 0) return;

    const expectedHandCount = Number(rawState.handCounts?.[myPlayerIndex] ?? 0);

    if (expectedHandCount <= 0) return;

    const retry = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('get_one_vs_one_snapshot', {
          p_room_id: roomId,
        });

        if (error) throw error;

        applySnapshot(data);
      } catch (err: any) {
        console.warn('1v1 private hand snapshot retry failed', err);
      }
    }, 350);

    return () => {
      clearTimeout(retry);
    };
  }, [roomId, loading, rawState, myHand.length, myPlayerIndex, applySnapshot]);

  const openingDouble =
    typeof rawState?.openingDouble === 'number' ? rawState.openingDouble : null;

  const isOpeningRound = Boolean(
    rawState?.isOpeningRound ?? rawState?.isFirstRound ?? true,
  );

  const playabilityContext = { board, spinnerValue: rawState?.spinnerValue ?? null, isOpeningRound, openingDouble };
  const availableBranchesForTile = (tile: DominoTileData): KozelBranch[] =>
    getAvailableBranches(tile, playabilityContext);

  const hasPlayableTile = useMemo(() => {
    return handHasPlayableTile(myHand, playabilityContext);
  }, [myHand, board, rawState, isOpeningRound, openingDouble]);

  const playTile = async (tile: DominoTileData, branch?: KozelBranch) => {
    if (!roomId) throw new Error('No 1v1 room id');
    if (pendingMoveRef.current) return false;
    const tileInMyHand = handContainsTile(myHand, tile.id);

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
      const result = await submitOneVsOneMove(roomId, tile, resolvedBranch);
      await applySuccessfulAction(result);
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

  const drawTile = async () => {
    if (!roomId) return false;
    return runMultiplayerAction({
      action: () => submitOneVsOneDraw(roomId),
      onSuccess: applySuccessfulAction,
      errorLabel: 'submit_one_vs_one action=draw failed',
    });
  };

  const passTurn = async () => {
    if (!roomId) return false;

    return runMultiplayerAction({
      action: () => submitOneVsOnePass(roomId),
      onSuccess: applySuccessfulAction,
      errorLabel: 'submit_one_vs_one action=pass failed',
    });
  };

  const syncServerClock = useCallback((serverNow: unknown) => {
    if (typeof serverNow !== 'string') return false;
    const serverNowMs = Date.parse(serverNow);
    if (!Number.isFinite(serverNowMs)) return false;
    serverClockOffsetMsRef.current = serverNowMs - Date.now();
    return true;
  }, []);

  const scheduleTimeoutRetry = useCallback((
    claim: TurnTimeoutClaim,
    turnKey: string,
    claimRoomId: string,
    expiresAt: unknown,
  ) => {
    clearTimeoutRetry();
    if (
      roomIdRef.current !== claimRoomId ||
      activeTurnKeyRef.current !== turnKey ||
      typeof expiresAt !== 'string'
    ) return;

    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      console.warn('submit_one_vs_one timeout response has no valid expiresAt');
      return;
    }

    const synchronizedNow = Date.now() + serverClockOffsetMsRef.current;
    const retryInMs = Math.max(0, expiresAtMs - synchronizedNow);
    timeoutRetryTurnKeyRef.current = turnKey;
    timeoutRetryRef.current = setTimeout(() => {
      timeoutRetryRef.current = null;
      timeoutRetryTurnKeyRef.current = null;
      if (
        roomIdRef.current === claimRoomId &&
        activeTurnKeyRef.current === turnKey
      ) {
        timeoutSubmitRef.current?.(claim, turnKey, claimRoomId);
      }
    }, retryInMs);
  }, [clearTimeoutRetry]);

  const submitTimeoutClaim = useCallback(async (
    claim: TurnTimeoutClaim,
    turnKey: string,
    claimRoomId: string,
  ) => {
    if (
      timeoutPassInFlightRef.current ||
      roomIdRef.current !== claimRoomId ||
      activeTurnKeyRef.current !== turnKey
    ) return;

    timeoutPassInFlightRef.current = true;
    try {
      const result = await submitOneVsOnePass(claimRoomId, true, claim);
      syncServerClock(result?.serverNow);
      if (
        roomIdRef.current !== claimRoomId ||
        activeTurnKeyRef.current !== turnKey
      ) return;

      clearTimeoutRetry();
      if (
        result.state?.myHandOwnerId &&
        result.state.myHandOwnerId !== currentUserIdRef.current
      ) {
        console.warn('Ignored 1v1 timeout response with mismatched hand owner');
      }
      await refreshSnapshot();
    } catch (caught) {
      const requestError = caught instanceof MultiplayerRequestError ? caught : null;
      const code = requestError?.code;
      const response = requestError?.details;
      syncServerClock(response?.serverNow);

      if (code === 'turn_timer_not_expired') {
        scheduleTimeoutRetry(
          claim,
          turnKey,
          claimRoomId,
          response?.expiresAt,
        );
        return;
      }

      if (code === 'stale_timeout' || code === 'already_processed') {
        clearTimeoutRetry();
        if (roomIdRef.current === claimRoomId) {
          await refreshSnapshot().catch(() => undefined);
        }
        return;
      }

      if (roomIdRef.current === claimRoomId) {
        await refreshSnapshot().catch(() => undefined);
      }
    } finally {
      timeoutPassInFlightRef.current = false;
    }
  }, [clearTimeoutRetry, refreshSnapshot, scheduleTimeoutRetry, syncServerClock]);

  const scheduleDrawTimeoutRetry = useCallback((
    claim: DrawTimeoutClaim,
    drawKey: string,
    claimRoomId: string,
    expiresAt: unknown,
  ) => {
    clearDrawTimeoutRetry();
    if (
      roomIdRef.current !== claimRoomId ||
      activeDrawKeyRef.current !== drawKey ||
      typeof expiresAt !== 'string'
    ) return;

    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) return;

    const synchronizedNow = Date.now() + serverClockOffsetMsRef.current;
    const retryInMs = Math.max(0, expiresAtMs - synchronizedNow);

    drawTimeoutRetryRef.current = setTimeout(() => {
      drawTimeoutRetryRef.current = null;
      if (
        roomIdRef.current === claimRoomId &&
        activeDrawKeyRef.current === drawKey
      ) {
        drawTimeoutSubmitRef.current?.(claim, drawKey, claimRoomId);
      }
    }, retryInMs);
  }, [clearDrawTimeoutRetry]);

  const submitDrawTimeoutClaim = useCallback(async (
    claim: DrawTimeoutClaim,
    drawKey: string,
    claimRoomId: string,
  ) => {
    if (
      drawTimeoutInFlightRef.current ||
      roomIdRef.current !== claimRoomId ||
      activeDrawKeyRef.current !== drawKey
    ) return;

    drawTimeoutInFlightRef.current = true;
    try {
      const result = await submitOneVsOneDraw(claimRoomId, true, claim);
      syncServerClock(result?.serverNow);

      if (
        roomIdRef.current !== claimRoomId ||
        activeDrawKeyRef.current !== drawKey
      ) return;

      clearDrawTimeoutRetry();
      await refreshSnapshot();
    } catch (caught) {
      const requestError = caught instanceof MultiplayerRequestError ? caught : null;
      const code = requestError?.code;
      const response = requestError?.details;
      syncServerClock(response?.serverNow);

      if (code === 'turn_timer_not_expired') {
        scheduleDrawTimeoutRetry(
          claim,
          drawKey,
          claimRoomId,
          response?.expiresAt,
        );
        return;
      }

      if (code === 'stale_timeout' || code === 'already_processed') {
        clearDrawTimeoutRetry();
        if (roomIdRef.current === claimRoomId) {
          await refreshSnapshot().catch(() => undefined);
        }
        return;
      }

      if (roomIdRef.current === claimRoomId) {
        await refreshSnapshot().catch(() => undefined);
      }
    } finally {
      drawTimeoutInFlightRef.current = false;
    }
  }, [
    clearDrawTimeoutRetry,
    refreshSnapshot,
    scheduleDrawTimeoutRetry,
    syncServerClock,
  ]);

  useEffect(() => {
    drawTimeoutSubmitRef.current = (claim, drawKey, claimRoomId) => {
      void submitDrawTimeoutClaim(claim, drawKey, claimRoomId);
    };
    return () => {
      drawTimeoutSubmitRef.current = null;
    };
  }, [submitDrawTimeoutClaim]);

  useEffect(() => {
    timeoutSubmitRef.current = (claim, turnKey, claimRoomId) => {
      void submitTimeoutClaim(claim, turnKey, claimRoomId);
    };
    return () => {
      timeoutSubmitRef.current = null;
    };
  }, [submitTimeoutClaim]);

  useEffect(() => {
    if (
      !roomId ||
      rawState?.canDrawTile !== true ||
      drawTimeLeft > 0 ||
      roundWinnerPlayerId ||
      winningTeamId ||
      drawTimeoutInFlightRef.current ||
      drawTimeoutRetryRef.current
    ) return;

    const expectedVersion = getSnapshotVersion(rawState);
    const expectedDrawStartedAt = rawState?.drawStartedAt;
    if (
      expectedVersion < 0 ||
      typeof expectedDrawStartedAt !== 'string' ||
      typeof currentTurnPlayerId !== 'string' ||
      !currentTurnPlayerId
    ) return;

    const claim: DrawTimeoutClaim = {
      expectedVersion,
      expectedDrawStartedAt,
      expectedTurnPlayerId: currentTurnPlayerId,
    };

    const drawKey = `${expectedVersion}:${expectedDrawStartedAt}:${currentTurnPlayerId}`;
    if (activeDrawKeyRef.current !== drawKey) return;

    void submitDrawTimeoutClaim(claim, drawKey, roomId);
  }, [
    roomId,
    rawState,
    drawTimeLeft,
    roundWinnerPlayerId,
    winningTeamId,
    currentTurnPlayerId,
    submitDrawTimeoutClaim,
  ]);

  useEffect(() => {
    if (
      !roomId ||
      turnTimeLeft > 0 ||
      roundWinnerPlayerId ||
      rawState?.canDrawTile === true ||
      winningTeamId ||
      timeoutPassInFlightRef.current ||
      timeoutRetryRef.current
    ) return;

    const expectedVersion = getSnapshotVersion(rawState);
    const expectedTurnStartedAt = rawState?.turnStartedAt ?? rawState?.updated_at;
    if (
      expectedVersion < 0 ||
      typeof expectedTurnStartedAt !== 'string' ||
      typeof currentTurnPlayerId !== 'string' ||
      !currentTurnPlayerId
    ) return;

    const claim: TurnTimeoutClaim = {
      expectedVersion,
      expectedTurnStartedAt,
      expectedTurnPlayerId: currentTurnPlayerId,
    };
    const turnKey = `${expectedVersion}:${expectedTurnStartedAt}:${currentTurnPlayerId}`;
    if (activeTurnKeyRef.current !== turnKey) return;
    void submitTimeoutClaim(claim, turnKey, roomId);
  }, [
    roomId,
    turnTimeLeft,
    roundWinnerPlayerId,
    winningTeamId,
    currentTurnPlayerId,
    rawState,
    submitTimeoutClaim,
  ]);

  return {
    loading,
    error,

    drawTimeLeft,

    players,
    currentTurnPlayerId,
    board,
    myHand,
    boneyardCount: rawState?.boneyardCount ?? 0,
    mode: '1v1',

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

    canDrawTile:
  rawState?.canDrawTile === true &&
  !!currentUserId &&
  currentTurnPlayerId === currentUserId &&
  !hasPlayableTile &&
  (rawState?.boneyardCount ?? 0) > 0 &&
  Number(rawState?.currentTurnDrawCount ?? 0) < MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN &&
  !rawState?.roundWinnerPlayerId &&
  !rawState?.winningTeamId,
    hasPlayableTile,
    lastPassedPlayerId: rawState?.lastPassedPlayerId ?? null,

    rawState,
    pendingMove,
    myPlayerIndex,
    opponentPlayerIndex,
    currentUserId,
    phase,
    roundResult,
    nextRoundCountdown,
  };
}