import { supabase } from '@/lib/supabase';

export async function submitOneVsOneDraw(roomId: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    throw new Error('User not authenticated');
  }

  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');

  if (!baseUrl) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL');
  }

  const res = await fetch(`${baseUrl}/functions/v1/submit_one_vs_one_draw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      room_id: roomId,
    }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error || 'submit_one_vs_one_draw failed');
  }

  return json;
}

export default submitOneVsOneDraw;