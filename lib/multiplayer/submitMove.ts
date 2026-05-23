import { supabase } from '@/lib/supabase';

type Tile = { id: string; left: number; right: number; imageKey?: string };

export async function submitMove(gameId: string, tile: Tile, branch?: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) throw new Error('User not authenticated');

  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')}/functions/v1/submit_move`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ game_id: gameId, tile, branch }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error || 'submit_move failed');
  }

  return json;
}

export default submitMove;
