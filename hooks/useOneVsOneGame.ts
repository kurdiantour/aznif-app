import { applyMove, createEmptyBoard } from '@/lib/game/kozel-engine';
import {
  submitOneVsOneDraw,
  submitOneVsOneMove,
  submitOneVsOnePass,
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
    RoundPhase, RoundResult,
    ScoringEvent,
    TeamId,
} from '@/types/game';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { MockGameState } from './useGameBase';
import { getAvailableBranches, handContainsTile, handHasPlayableTile } from './gameRuleQueries';
import { getPlayerIndex, getRelativeSeat } from './multiplayerPlayerNormalization';
import { runMultiplayerAction } from './multiplayerAction';
import { buildRoundResult } from './roundResult';
import { useRoundLifecycle } from './useRoundLifecycle';
import {
  MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN,
  NEXT_ROUND_COUNTDOWN_SECONDS,
  PLAYER_TURN_DURATION_SECONDS,
  ROUND_RESULT_REVEAL_MS,
  ROUND_TRANSITION_SYNC_MS,
} from './gameShared';

type UseOneVsOneResult = Omit<MockGameState, 'playTile' | 'drawTile' | 'passTurn'> & {
  loading: boolean;
  error: string | null;
  rawState: any;
  myPlayerIndex: number;
  opponentPlayerIndex: number;
  currentUserId: string | null;
  pendingMove: PendingMultiplayerMove | null;
  playTile: (tile: DominoTileData, branch?: KozelBranch) => Promise<any>;
  drawTile: () => Promise<boolean>;
  passTurn: () => Promise<boolean>;
};

export function useOneVsOneGame(roomId?: string): UseOneVsOneResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawState, setRawState] = useState<any>(null);
  const [playersRows, setPlayersRows] = useState<any[]>([]);
  const [profileById, setProfileById] = useState<Map<string, any>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [turnTimeLeft, setTurnTimeLeft] = useState(PLAYER_TURN_DURATION_SECONDS);
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


  useEffect(() => {
    latestVersionRef.current = -1;
    pendingMoveRef.current = null;
    setPendingMove(null);
  }, [roomId]);

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
      .select('id, username, avatar_id, level, points')
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

    const actionState = actionSnapshot.state;
    const isTerminalAction =
      actionSnapshot.status === 'finished' ||
      actionState?.status === 'finished' ||
      !!actionState?.winningTeamId;

    if (isTerminalAction) return true;

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
            if (status === 'SUBSCRIBED') void loadRoom();
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
            () => void refreshPlayers(),
          )
          .subscribe((status, err) => {
            if (!mounted) return;
            if (status === 'SUBSCRIBED') void refreshPlayers();
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
            (payload) => {
              if (!mounted) return;
              void loadRoom();
              if ((payload.new as any)?.action === 'manual_leave_takeover') {
                void refreshPlayers();
              }
            },
          )
          .subscribe((status, err) => {
            if (!mounted) return;
            if (status === 'SUBSCRIBED') void loadRoom();
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setError(err?.message ?? 'Realtime move sync failed');
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

    };
  }, [roomId, applySnapshot, refreshSnapshot, refreshPlayers]);

  useEffect(() => {
    if (!roomId || !currentUserId) return;

    const heartbeat = async () => {
      const { error } = await supabase.rpc('one_vs_one_player_heartbeat', {
        p_room_id: roomId,
      });
      if (error) console.warn('1v1 heartbeat failed', error);
    };

    void heartbeat();
    const interval = setInterval(() => void heartbeat(), 10_000);
    return () => clearInterval(interval);
  }, [roomId, currentUserId]);

  useEffect(() => {
    if (!roomId || !currentUserId) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') return;
      void supabase.rpc('mark_one_vs_one_player_disconnected', {
        p_room_id: roomId,
        p_user_id: currentUserId,
      });
    });
    return () => subscription.remove();
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
      rawState?.roundWinnerPlayerId ||
      rawState?.winningTeamId ||
      rawState?.status === 'finished'
    ) return;

    const pollSnapshot = async () => {
      if (pollInFlightRef.current) return;

      pollInFlightRef.current = true;
      try {
        await Promise.all([refreshSnapshot(), refreshPlayers(false)]);
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
  }, [
    roomId,
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
  }, [currentTurnPlayerId, rawState?.turnStartedAt, rawState?.updated_at, roundWinnerPlayerId, winningTeamId]);

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
        timeLeft: playerId === state.currentTurnPlayerId
          ? turnTimeLeft
          : PLAYER_TURN_DURATION_SECONDS,
        tileCount: handCounts[playerIndex] ?? 0,
        score: state.teamScores?.[row.team_id] ?? 0,
        isLeader: state.leaderPlayerId ? playerId === state.leaderPlayerId : false,
        avatarId: profile?.avatar_id,
      };
    });
  }, [playersRows, profileById, rawState, myPlayerIndex, turnTimeLeft]);

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

  useEffect(() => {
    if (!roomId || turnTimeLeft > 0 || roundWinnerPlayerId || winningTeamId) return;
    if (timeoutPassInFlightRef.current) return;
    timeoutPassInFlightRef.current = true;
    void submitOneVsOnePass(roomId, true)
      .then((result) => {
        if (!result?.ok) return;
        if (
          result.state?.myHandOwnerId &&
          result.state.myHandOwnerId !== currentUserId
        ) {
          console.warn('Ignored 1v1 timeout response with mismatched hand owner');
        }
        return refreshSnapshot();
      })
      .catch(() => refreshSnapshot().catch(() => undefined))
      .finally(() => {
        timeoutPassInFlightRef.current = false;
      });
  }, [roomId, turnTimeLeft, roundWinnerPlayerId, winningTeamId, currentTurnPlayerId, currentUserId, refreshSnapshot]);

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
