import { canHandMove, createEmptyBoard, getPlayableBranches } from '@/lib/game/kozel-engine';
import submitMove from '@/lib/multiplayer/submitMove';
import { supabase } from '@/lib/supabase';
import type {
  DominoTileData,
  GameMode,
  KozelBoardState,
  KozelBranch,
  MatchReward,
  ScoringEvent,
  TeamId,
} from '@/types/game';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MockGameState } from './useGameBase';

type UseMultiplayerResult = Omit<MockGameState, 'playTile'> & {
  loading: boolean;
  error: string | null;
  rawState: any;
  playTile: (tile: DominoTileData, branch?: KozelBranch) => Promise<any>;
};

function getDisplaySeat(
  rowIndex: number,
  myRowIndex: number,
  mode: GameMode,
): 'bottom' | 'top' | 'left' | 'right' {
  const totalSeats = mode === '1v1' ? 2 : 4;
  const offset = (rowIndex - myRowIndex + totalSeats) % totalSeats;

  if (mode === '1v1') {
    return offset === 0 ? 'bottom' : 'top';
  }

  if (offset === 0) return 'bottom';
  if (offset === 1) return 'right';
  if (offset === 2) return 'top';
  return 'left';
}

export default function useMultiplayerGame(gameId?: string): UseMultiplayerResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawState, setRawState] = useState<any>(null);
  const [playersRows, setPlayersRows] = useState<any[]>([]);
  const [profileById, setProfileById] = useState<Map<string, any>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const roomChannelRef = useRef<any>(null);
  const playersChannelRef = useRef<any>(null);

  useEffect(() => {
    if (!gameId) {
      setError('No game id');
      setLoading(false);
      return;
    }

    let mounted = true;

    const loadRoom = async () => {
      const { data: roomData, error: roomErr } = await supabase
        .from('game_rooms')
        .select('id, state, status, current_turn_player_id, version, mode')
        .eq('id', gameId)
        .maybeSingle();

      if (roomErr) throw roomErr;
      if (!mounted) return null;

      const nextState = {
        ...(roomData?.state ?? {}),
        currentTurnPlayerId:
          roomData?.state?.currentTurnPlayerId ??
          roomData?.current_turn_player_id ??
          null,
        mode: roomData?.state?.mode ?? roomData?.mode ?? '2v2',
      };

      setRawState(nextState);
      return nextState;
    };

    const loadPlayers = async () => {
      const { data: pRows, error: pErr } = await supabase
        .from('game_players')
        .select('id, user_id, player_index, seat, team_id, kind')
        .eq('game_id', gameId)
        .order('player_index', { ascending: true });

      if (pErr) throw pErr;
      if (!mounted) return [];

      const rows = pRows ?? [];
      setPlayersRows(rows);

      const userIds = rows.map((row: any) => row.user_id).filter(Boolean);

      if (userIds.length > 0) {
        const { data: profiles, error: profilesErr } = await supabase
          .from('profiles')
          .select('id, username, avatar_id, level, points')
          .in('id', userIds);

        if (!profilesErr && mounted) {
          setProfileById(
            new Map((profiles ?? []).map((profile: any) => [profile.id, profile])),
          );
        }
      } else if (mounted) {
        setProfileById(new Map());
      }

      return rows;
    };

    const boot = async () => {
      try {
        setLoading(true);
        setError(null);

        const userResp = await supabase.auth.getUser();
        const userId = userResp?.data?.user?.id ?? null;

        if (!mounted) return;

        setCurrentUserId(userId);

        await Promise.all([loadRoom(), loadPlayers()]);

        if (!mounted) return;

        roomChannelRef.current = supabase
          .channel(`game_rooms:${gameId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'game_rooms',
              filter: `id=eq.${gameId}`,
            },
            (payload: any) => {
              if (!mounted) return;

              setRawState({
                ...(payload.new?.state ?? {}),
                currentTurnPlayerId:
                  payload.new?.state?.currentTurnPlayerId ??
                  payload.new?.current_turn_player_id ??
                  null,
                mode: payload.new?.state?.mode ?? payload.new?.mode ?? '2v2',
              });
            },
          )
          .subscribe();

        playersChannelRef.current = supabase
          .channel(`game_players:${gameId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'game_players',
              filter: `game_id=eq.${gameId}`,
            },
            () => {
              void loadPlayers();
            },
          )
          .subscribe();

        setLoading(false);
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
  }, [gameId]);

  const mode: GameMode =
    rawState?.mode === '1v1' || playersRows.length <= 2 ? '1v1' : '2v2';

  const myRowIndex = useMemo(() => {
    if (!currentUserId) return 0;

    const index = playersRows.findIndex((row: any) => row.user_id === currentUserId);

    return index >= 0 ? index : 0;
  }, [playersRows, currentUserId]);

  const players = useMemo(() => {
    const state = rawState ?? {};
    const hands = state.hands ?? [];

    return playersRows.map((row: any, index: number) => {
      const playerId = row.user_id ?? `bot-${row.id}`;
      const profile = row.user_id ? profileById.get(row.user_id) : null;

      return {
        id: playerId,
        name: profile?.username ?? (row.user_id ? 'Player' : 'Bot'),
        seat: getDisplaySeat(index, myRowIndex, mode),
        kind: row.kind,
        teamId: row.team_id,
        isActive: playerId === (state.currentTurnPlayerId ?? state.current_turn_player_id),
        timeLeft: 10,
        tileCount: (hands[index] ?? []).length,
        score: state.teamScores?.[row.team_id] ?? 0,
        isLeader: state.leaderPlayerId ? playerId === state.leaderPlayerId : false,
        avatarId: profile?.avatar_id,
      };
    });
  }, [playersRows, profileById, rawState, myRowIndex, mode]);

  const board: KozelBoardState = rawState?.board ?? createEmptyBoard();

  const currentTurnPlayerId: string =
    rawState?.currentTurnPlayerId ??
    rawState?.current_turn_player_id ??
    players[0]?.id ??
    '';

  const teamScores: Record<TeamId, number> = {
    teamA: rawState?.teamScores?.teamA ?? 0,
    teamB: rawState?.teamScores?.teamB ?? 0,
  };

  const roundWinnerPlayerId: string | null = rawState?.roundWinnerPlayerId ?? null;
  const lastPlayedTile: DominoTileData | null = rawState?.lastPlayedTile ?? null;
  const lastScoringEvent: ScoringEvent | null = rawState?.lastScoringEvent ?? null;
  const lastPassedPlayerId: string | null = rawState?.lastPassedPlayerId ?? null;

  const winningTeamId: TeamId | null = rawState?.winningTeamId ?? null;
  const matchReward: MatchReward | null = rawState?.matchReward ?? null;

  const leaderPlayerId: string = rawState?.leaderPlayerId ?? players[0]?.id ?? '';
  const isFirstRound: boolean =
  Boolean(
    rawState?.isOpeningRound ??
    rawState?.isFirstRound ??
    false,
  );

  const openingDouble: number | null =
  typeof rawState?.openingDouble === 'number'
    ? rawState.openingDouble
    : null;

  const boneyardCount: number = rawState?.boneyardCount ?? rawState?.boneyard?.length ?? 0;

  const myHand: DominoTileData[] = useMemo(() => {
    const hands = rawState?.hands ?? [];
    return hands[myRowIndex] ?? [];
  }, [rawState, myRowIndex]);

  useEffect(() => {
    if (!gameId) return;

    const hands = rawState?.hands;
    const hasHands = Array.isArray(hands)
      ? hands.length > 0
      : !!hands && Object.keys(hands).length > 0;

    if (hasHands) return;
    if (playersRows.length === 0) return;

    const timeout = setTimeout(async () => {
      const { data, error } = await supabase
        .from('game_rooms')
        .select('state, current_turn_player_id, mode')
        .eq('id', gameId)
        .maybeSingle();

      if (error || !data) return;

      setRawState({
        ...(data.state ?? {}),
        currentTurnPlayerId:
          data.state?.currentTurnPlayerId ??
          data.current_turn_player_id ??
          null,
        mode: data.state?.mode ?? data.mode ?? '2v2',
      });
    }, 700);

    return () => clearTimeout(timeout);
  }, [gameId, rawState?.hands, playersRows.length]);

  const availableBranchesForTile = (tile: DominoTileData): KozelBranch[] => {
    try {
return getPlayableBranches(
  tile,
  board,
  rawState?.spinnerValue ?? null,
  rawState?.isOpeningRound ??
    rawState?.isFirstRound ??
    true,
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
  rawState?.isOpeningRound ??
    rawState?.isFirstRound ??
    true,
  openingDouble,
);
    } catch {
      return false;
    }
  }, [myHand, board, rawState]);

  const canDrawTile: boolean = Boolean(rawState?.canDrawTile ?? false);

  const playTile = async (tile: DominoTileData, branch?: KozelBranch) => {
    if (!gameId) throw new Error('No game id');

    const res = await submitMove(gameId, tile, branch);

    return res;
  };

  const drawTile = () => false;

  const passTurn = () => false;

  return {
    loading,
    error,

    players,
    currentTurnPlayerId,
    board,
    myHand,
    boneyardCount,
    mode,

    roundWinnerPlayerId,
    lastPlayedTile,
    lastScoringEvent,
    teamScores,
    winningTeamId,
    matchReward,

    leaderPlayerId,
    isFirstRound,

    availableBranchesForTile,
    playTile,
    passTurn,
    drawTile,

    canDrawTile,
    hasPlayableTile,
    lastPassedPlayerId,

    rawState,
  };
}