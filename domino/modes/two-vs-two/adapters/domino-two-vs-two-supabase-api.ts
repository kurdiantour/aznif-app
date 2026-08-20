import { supabase } from '@/lib/supabase';
import { processDominoBotTurns, submitTwoVsTwoMove, submitTwoVsTwoPass, type TurnTimeoutClaim } from '@/lib/multiplayer/multiplayerApi';
import type { DominoTileData, KozelBranch } from '@/types/game';

export const getDominoTwoVsTwoSnapshot = (roomId: string) =>
  supabase.rpc('get_two_vs_two_snapshot', { p_room_id: roomId });

export const getDominoTwoVsTwoRoster = (roomId: string) =>
  supabase.from('two_vs_two_players')
    .select('id, user_id, player_index, seat, team_id, kind, connected, bot_takeover, abandoned')
    .eq('room_id', roomId).order('player_index', { ascending: true });

export const getDominoTwoVsTwoProfiles = (userIds: string[]) =>
  supabase.from('profiles').select('id, username, avatar_id, points').in('id', userIds);

export const submitDominoTwoVsTwoMove = (roomId: string, tile: DominoTileData, branch: KozelBranch) =>
  submitTwoVsTwoMove(roomId, tile, branch);

export const submitDominoTwoVsTwoPass = (roomId: string, timeout = false, claim?: TurnTimeoutClaim) =>
  submitTwoVsTwoPass(roomId, timeout, claim);

export const processDominoTwoVsTwoBotTurn = (roomId: string) =>
  processDominoBotTurns('2v2', roomId);

export const startDominoTwoVsTwoNextHand = (roomId: string) =>
  supabase.functions.invoke('submit_two_vs_two', { body: { action: 'next_hand', room_id: roomId } });
