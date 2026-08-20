import { createEmptyBoard } from '@/domino/core/engine/kozel-engine';
import { MultiplayerRequestError, type TurnTimeoutClaim } from '@/lib/multiplayer/multiplayerApi';
import { getSnapshotVersion, type PendingMultiplayerMove } from '@/lib/multiplayer/optimisticMove';
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
import type { MockGameState } from '@/hooks/useGameBase';
import { getAvailableBranches, handHasPlayableTile } from '@/domino/shared/rules/game-rule-queries';
import { getPlayerIndex, getRelativeSeat } from '@/lib/multiplayer/core/player-normalization';
import { runMultiplayerAction } from '@/lib/multiplayer/core/multiplayer-action';
import { buildRoundResult } from '@/domino/shared/lifecycle/round-result';
import { useRoundLifecycle } from '@/domino/shared/lifecycle/use-round-lifecycle';
import { PLAYER_TURN_DURATION_SECONDS } from '@/domino/shared/game-shared';
import { SupabaseDominoTwoVsTwoAdapter } from '../adapters/supabase-domino-two-vs-two-adapter';
import { createDominoTwoVsTwoPendingMove, isDominoTwoVsTwoMoveCommitted, normalizeDominoTwoVsTwoSnapshot } from '../controllers/domino-two-vs-two-controller';

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
  const adapter = useMemo(() => roomId ? new SupabaseDominoTwoVsTwoAdapter(roomId) : null, [roomId]);

  const roomChannelRef = useRef<any>(null);
  const playersChannelRef = useRef<any>(null);
  const pollInFlightRef = useRef(false);
  const botTurnInFlightRef = useRef(false);
  const takeoverWatchdogInFlightRef = useRef(false);
  const latestVersionRef = useRef(-1);
  const pendingMoveRef = useRef<PendingMultiplayerMove | null>(null);
  const timeoutPassInFlightRef = useRef(false);
  const timeoutRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTurnKeyRef = useRef<string | null>(null);
  const serverClockOffsetMsRef = useRef(0);
  const roomIdRef = useRef(roomId);
  const timeoutSubmitRef = useRef<((claim: TurnTimeoutClaim, turnKey: string, claimRoomId: string) => void) | null>(null);
  const lastRealtimeActivityRef = useRef<number>(Date.now());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef<number>(0);


  const clearTimeoutRetry = useCallback(() => {
    if (timeoutRetryRef.current) {
      clearTimeout(timeoutRetryRef.current);
      timeoutRetryRef.current = null;
    }
  }, []);

  useEffect(() => {
    roomIdRef.current = roomId;
    latestVersionRef.current = -1;
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
          .select('id, username, avatar_id, points')
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

await Promise.all([loadRoom(), loadPlayers()]);

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
            void loadPlayers();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`2v2 Realtime ${channelName} status: ${status}`, err);
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
    (payload) => {
      if (!mounted) return;

      markRealtimeActivity();

      const updatedRoom = payload.new as any;

      if (!updatedRoom) return;

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

          // Realtime room updates contain public gameplay state.
          // Preserve this device's authenticated private hand data.
          privateHands: previousState?.privateHands,
          debugPrivateHandsRaw: previousState?.debugPrivateHandsRaw,
          myHand: previousState?.myHand ?? [],

          mode: '2v2',

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

        clearTimeoutRetry();

        const pending = pendingMoveRef.current;

        if (
          pending && isDominoTwoVsTwoMoveCommitted(nextRawState, version, pending)
        ) {
          pendingMoveRef.current = null;
          setPendingMove(null);
        }

        return nextRawState;
      });
    },
  )
  .subscribe((status, err) =>
    handleChannelStatus('rooms', status, err),
  );

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
              (payload) => {
                if (!mounted) return;
                markRealtimeActivity();
                void loadPlayers();
              },
            )
            .subscribe((status, err) => handleChannelStatus('players', status, err));
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
    };
  }, [roomId, applySnapshot, refreshSnapshot]);

  useEffect(() => {
    if (!roomId) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshSnapshot()
          .then(() => {
            lastRealtimeActivityRef.current = Date.now();
          })
          .catch((err) => {
            console.warn('2v2 AppState reconcile failed', err);
          });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [roomId, refreshSnapshot]);

  useEffect(() => {
    if (
      !roomId ||
      loading ||
      rawState?.status === 'finished' ||
      rawState?.winningTeamId
    ) return;

    const pollFallbackWatchdog = async () => {
      if (pollInFlightRef.current) return;
      const silentMs = Date.now() - lastRealtimeActivityRef.current;
      if (silentMs < 12_000) return;

      pollInFlightRef.current = true;
      try {
        await refreshSnapshot();
        lastRealtimeActivityRef.current = Date.now();
      } catch (err) {
        console.warn('2v2 snapshot fallback watchdog failed', err);
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const interval = setInterval(() => void pollFallbackWatchdog(), 5000);
    return () => {
      clearInterval(interval);
      pollInFlightRef.current = false;
    };
  }, [roomId, loading, rawState?.status, rawState?.winningTeamId, refreshSnapshot]);
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
        name: row.bot_takeover
          ? 'رۆبوتی کاتی'
          : profile?.username ?? (row.user_id ? 'Player' : 'Bot'),
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
        ? Math.floor((Date.now() + serverClockOffsetMsRef.current - turnStartedAt) / 1000)
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

    void adapter!.processBotTurn()
      .catch((error) => {
        console.warn('process_bot_turns 2v2 failed', error);
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
      if (!adapter) return;
      const data = await adapter.getSnapshot().catch(() => null);
      if (!data) return;
      applySnapshot(data);
    }, 700);

    return () => clearTimeout(timeout);
  }, [roomId, rawState?.handCounts, playersRows.length, applySnapshot]);

  const playTile = async (tile: DominoTileData, branch?: KozelBranch) => {
    if (!roomId) throw new Error('No 2v2 room id');
    if (pendingMoveRef.current) return false;

    const resolvedBranch = branch ?? availableBranchesForTile(tile)[0];
    if (!resolvedBranch) return false;

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
    // A queued pass countdown from the previous hand can fire while the new
    // empty board snapshot is arriving. Passing is never legal before the
    // opening tile, so stop it locally instead of sending a stale request.
    if (
      !board.centerTile ||
      rawState?.roundWinnerPlayerId ||
      rawState?.winningTeamId
    ) return false;

    return runMultiplayerAction({
      action: () => adapter!.dispatch({ type: 'pass' }),
      onSuccess: (result) => !!result?.ok,
      errorLabel: 'submit_two_vs_two action=pass failed',
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
      console.warn('submit_two_vs_two timeout response has no valid expiresAt');
      return;
    }

    const synchronizedNow = Date.now() + serverClockOffsetMsRef.current;
    timeoutRetryRef.current = setTimeout(() => {
      timeoutRetryRef.current = null;
      if (
        roomIdRef.current === claimRoomId &&
        activeTurnKeyRef.current === turnKey
      ) {
        timeoutSubmitRef.current?.(claim, turnKey, claimRoomId);
      }
    }, Math.max(0, expiresAtMs - synchronizedNow));
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
      const result = await adapter!.dispatch({ type: 'timeout-pass', claim });
      syncServerClock(result?.serverNow);
      if (
        roomIdRef.current !== claimRoomId ||
        activeTurnKeyRef.current !== turnKey
      ) return;
      clearTimeoutRetry();
      if (
        result.state?.myHandOwnerId &&
        result.state.myHandOwnerId !== currentUserId
      ) {
        console.warn('Ignored 2v2 timeout response with mismatched hand owner');
      }
      await refreshSnapshot();
    } catch (caught) {
      const requestError = caught instanceof MultiplayerRequestError ? caught : null;
      const code = requestError?.code;
      const response = requestError?.details;
      syncServerClock(response?.serverNow);

      if (code === 'turn_timer_not_expired') {
        scheduleTimeoutRetry(claim, turnKey, claimRoomId, response?.expiresAt);
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
  }, [clearTimeoutRetry, currentUserId, refreshSnapshot, scheduleTimeoutRetry, syncServerClock]);

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
      turnTimeLeft > 0 ||
      rawState?.roundWinnerPlayerId ||
      rawState?.winningTeamId ||
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
    currentTurnPlayerId,
    rawState,
    submitTimeoutClaim,
  ]);

  const startNextRound = useCallback(async () => {
    if (!roomId) return;
    try {
      await adapter!.startNextHand();
    } catch (err) {
      console.warn('start next 2v2 hand failed', err);
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
      endReason: rawState?.roundEndReason,
      awardedPoints: rawState?.endOfHandScoringEvent?.points ?? 0,
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
    nextRoundCountdown,

    rawState,
    pendingMove,
  };
}
