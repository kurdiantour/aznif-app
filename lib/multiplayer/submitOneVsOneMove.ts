import { supabase } from '@/lib/supabase';

type Tile = {
  id: string;
  left: number;
  right: number;
  imageKey?: string;
};

export async function submitOneVsOneMove(
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

  const url = `${baseUrl}/functions/v1/submit_one_vs_one_move`;

  const res = await fetch(url, {
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
    throw new Error(json?.error || 'submit_one_vs_one_move failed');
  }

  return json;
}

export default submitOneVsOneMove;