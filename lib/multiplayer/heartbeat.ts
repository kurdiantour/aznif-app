import { supabase } from '@/lib/supabase';

export async function sendHeartbeat(gameId: string) {
  try {
    const { data, error } = await supabase.rpc('player_heartbeat', { p_game_id: gameId });
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('heartbeat failed', err);
    return null;
  }
}

export async function restoreHumanControl(gameId: string) {
  try {
    const { data, error } = await supabase.rpc('restore_human_control', { p_game_id: gameId });
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('restore_human_control failed', err);
    return null;
  }
}

export async function markDisconnected(gameId: string, userId: string) {
  try {
    const { data, error } = await supabase.rpc('mark_player_disconnected', { p_game_id: gameId, p_user_id: userId });
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('mark_player_disconnected failed', err);
    return null;
  }
}

export default { sendHeartbeat, restoreHumanControl, markDisconnected };