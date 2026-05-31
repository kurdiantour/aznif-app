import { canHandMove, createEmptyBoard, getPlayableBranches } from '@/lib/game/kozel-engine';
import submitTwoVsTwoMove from '@/lib/multiplayer/submitTwoVsTwoMove';
import submitTwoVsTwoPass from '@/lib/multiplayer/submitTwoVsTwoPass';
import { supabase } from '@/lib/supabase';
import type {
  DominoTileData,
  KozelBoardState,
  KozelBranch,
  MatchReward,
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
  rowIndex: number,
  myRowIndex: number,
): 'bottom' | 'top' | 'left' | 'right' {
  const totalSeats = 4;
  const offset = (rowIndex - myRowIndex + totalSeats) % totalSeats;

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

  const myRowIndex = useMemo(() => {
    if (!currentUserId) return 0;
    const index = playersRows.findIndex((row) => row.user_id === currentUserId);
    return index >= 0 ? index : 0;
  }, [playersRows, currentUserId]);

  const players = useMemo(() => {
    const state = rawState ?? {};
    const handCounts = state.handCounts ?? [];

    return playersRows.map((row, index) => {
      const playerId = row.user_id ?? `bot-${row.id}`;
      const profile = row.user_id ? profileById.get(row.user_id) : null;

      return {
        id: playerId,
        name: profile?.username ?? (row.user_id ? 'Player' : 'Bot'),
        seat: getDisplaySeat(index, myRowIndex),
        kind: row.kind,
        teamId: row.team_id,
        isActive: playerId === state.currentTurnPlayerId,
        timeLeft: 10,
        tileCount: handCounts[index] ?? 0,
        score: state.teamScores?.[row.team_id] ?? 0,
        isLeader: state.leaderPlayerId ? playerId === state.leaderPlayerId : false,
        avatarId: profile?.avatar_id,
      };
    });
  }, [playersRows, profileById, rawState, myRowIndex]);

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
    return rawState?.myHand ?? [];
  }, [rawState]);

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
      console.warn('submit_two_vs_two_pass failed', err);
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

    rawState,
  };
}