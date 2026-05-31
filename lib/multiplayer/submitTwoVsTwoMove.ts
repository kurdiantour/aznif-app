import { supabase } from '@/lib/supabase';

type Tile = {
  id: string;
  left: number;
  right: number;
  imageKey?: string;
};

export async function submitTwoVsTwoMove(
  roomId: string,
  tile: Tile,
  branch?: string,
) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    throw new Error('User not authenticated');
  }

  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');

  if (!baseUrl) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL');
  }

  const res = await fetch(`${baseUrl}/functions/v1/submit_two_vs_two_move`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      room_id: roomId,
      tile,
      branch,
    }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error || 'submit_two_vs_two_move failed');
  }

  return json;
}

export default submitTwoVsTwoMove;
