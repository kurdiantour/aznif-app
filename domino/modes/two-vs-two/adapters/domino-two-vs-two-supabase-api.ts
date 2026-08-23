import { supabase } from '@/lib/supabase';
import { createMultiplayerCommandClient } from '@/lib/multiplayer/core/http-command-client';
import type { DominoTileData, KozelBranch } from '@/domino/types/domino-game';
import type { DominoTwoVsTwoTurnTimeoutClaim } from './domino-two-vs-two-adapter';

const EXPECTED_COMMAND_CODES = new Set([
  "turn_timer_not_expired",
  "stale_timeout",
  "already_processed",
]);

const submitCommand = createMultiplayerCommandClient({
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  getBaseUrl: () => process.env.EXPO_PUBLIC_SUPABASE_URL,
  expectedErrorCodes: EXPECTED_COMMAND_CODES,
});

export const getDominoTwoVsTwoSnapshot = (roomId: string) =>
  supabase.rpc('get_two_vs_two_snapshot', { p_room_id: roomId });

export const getDominoTwoVsTwoRoster = (roomId: string) =>
  supabase.from('two_vs_two_players')
    .select('id, user_id, player_index, seat, team_id, kind, connected, bot_takeover, abandoned')
    .eq('room_id', roomId).order('player_index', { ascending: true });

export const getDominoTwoVsTwoProfiles = (userIds: string[]) =>
  supabase.from('profiles').select('id, username, avatar_id, points').in('id', userIds);

export const submitDominoTwoVsTwoMove = (
  roomId: string,
  tile: DominoTileData,
  branch: KozelBranch,
) => submitCommand('submit_two_vs_two', {
  action: 'move',
  room_id: roomId,
  tile,
  branch,
});

export const submitDominoTwoVsTwoPass = (
  roomId: string,
  timedOut = false,
  claim?: DominoTwoVsTwoTurnTimeoutClaim,
) => submitCommand('submit_two_vs_two', {
  action: 'pass',
  room_id: roomId,
  timed_out: timedOut,
  ...(claim
    ? {
        expected_version: claim.expectedVersion,
        expected_turn_started_at: claim.expectedTurnStartedAt,
        expected_turn_player_id: claim.expectedTurnPlayerId,
      }
    : {}),
});

export const startDominoTwoVsTwoNextHand = (
  roomId: string,
  completedRoundId: string,
) => submitCommand('submit_two_vs_two', {
  action: 'start_next_hand',
  room_id: roomId,
  expected_completed_round_id: completedRoundId,
});
export async function processDominoTwoVsTwoBotTurn(roomId: string) {
  const { data, error } = await supabase.functions.invoke('process_bot_turns', {
    body: { mode: '2v2', room_id: roomId },
  });
  if (error) throw error;
  return data;
}