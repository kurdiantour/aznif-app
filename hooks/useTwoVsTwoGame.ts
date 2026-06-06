import { canHandMove, createEmptyBoard, getPlayableBranches } from '@/lib/game/kozel-engine';
import {
  submitTwoVsTwoMove,
  submitTwoVsTwoPass,
} from '@/lib/multiplayer/multiplayerApi';
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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MockGameState } from './useGameBase';

type UseTwoVsTwoResult = Omit<MockGameState, 'playTile' | 'passTurn'> & {
  loading: boolean;
  error: string | null;
  rawState: any;
  playTile: (tile: DominoTileData, branch?: KozelBranch) => Promise<any>;
  passTurn: () => Promise<boolean>;
};

function getDisplaySeat(
  playerIndex: number,
  myPlayerIndex: number,
): 'bottom' | 'top' | 'left' | 'right' {
  const totalSeats = 4;
  const offset = (playerIndex - myPlayerIndex + totalSeats) % totalSeats;

  if (offset === 0) return 'bottom';
  if (offset === 1) return 'right';
  if (offset === 2) return 'top';
  return 'left';
}

export function useTwoVsTwoGame(roomId?: string): UseTwoVsTwoResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawState, setRawState] = useState<any>(null);
  const [playersRows, setPlayersRows] = useState<any[]>([]);
  const [profileById, setProfileById] = useState<Map<string, any>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const roomChannelRef = useRef<any>(null);
  const playersChannelRef = useRef<any>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<RoundPhase>('playing');
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [nextRoundCountdown, setNextRoundCountdown] = useState<number>(5);

  useEffect(() => {
    if (!roomId) {
      setError('No 2v2 room id');
      setLoading(false);
      return;
    }

    let mounted = true;

    const applySnapshot = (snapshot: any) => {
      setRawState({
        ...(snapshot ?? {}),
        ...(snapshot?.state ?? {}),
        mode: '2v2',
        currentTurnPlayerId:
          snapshot?.state?.currentTurnPlayerId ??
          snapshot?.current_turn_player_id ??
          null,
      });
    };

    const loadRoom = async () => {
      const { data, error } = await supabase.rpc('get_two_vs_two_snapshot', {
        p_room_id: roomId,
      });

      if (error) throw error;
      if (!mounted) return;

      applySnapshot(data);
    };

    const loadPlayers = async () => {
      const { data, error } = await supabase
        .from('two_vs_two_players')
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
  }, [roomId]);

  const myPlayerIndex = useMemo(() => {
    if (!currentUserId) return -1;
    const myRow = playersRows.find((row) => row.user_id === currentUserId);
    return typeof myRow?.player_index === 'number' ? myRow.player_index : -1;
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
        seat: getDisplaySeat(playerIndex, myPlayerIndex),
        kind: row.kind,
        teamId: row.team_id,
        isActive: playerId === state.currentTurnPlayerId,
        timeLeft: 10,
        tileCount: playerIndex >= 0 ? handCounts[playerIndex] ?? 0 : 0,
        score: state.teamScores?.[row.team_id] ?? 0,
        isLeader: state.leaderPlayerId ? playerId === state.leaderPlayerId : false,
        avatarId: profile?.avatar_id,
      };
    });
  }, [playersRows, profileById, rawState, myPlayerIndex]);

  const board: KozelBoardState = rawState?.board ?? createEmptyBoard();

  const currentTurnPlayerId =
    rawState?.currentTurnPlayerId ??
    rawState?.current_turn_player_id ??
    players[0]?.id ??
    '';

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

      setRawState({
        ...(data ?? {}),
        ...(data.state ?? {}),
        mode: '2v2',
        currentTurnPlayerId:
          data.state?.currentTurnPlayerId ??
          data.current_turn_player_id ??
          null,
      });
    }, 700);

    return () => clearTimeout(timeout);
  }, [roomId, rawState?.handCounts, playersRows.length]);

  useEffect(() => {
    const winnerId = rawState?.roundWinnerPlayerId ?? null;
    if (!winnerId || rawState?.winningTeamId) return;

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

  const playTile = async (tile: DominoTileData, branch?: KozelBranch) => {
    if (!roomId) throw new Error('No 2v2 room id');
    return submitTwoVsTwoMove(roomId, tile, branch);
  };

  const drawTile = () => false;

  const passTurn = async () => {
    if (!roomId) return false;

    try {
      const result = await submitTwoVsTwoPass(roomId);
      return !!result?.ok;
    } catch (err) {
      console.warn('submit_two_vs_two action=pass failed', err);
      return false;
    }
  };

  const startNextRound = async () => {
    if (!roomId) return;
    setPhase('dealing');
    try {
      await supabase.rpc('start_two_vs_two_game', { p_room_id: roomId });
    } catch (err) {
      console.warn('start_two_vs_two_game failed', err);
    } finally {
      setRoundResult(null);
      setNextRoundCountdown(5);
      setPhase('playing');
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
  };
}
