import { supabase } from '@/lib/supabase';

type Tile = {
  id: string;
  left: number;
  right: number;
  imageKey?: string;
};

type RequestBody = Record<string, unknown>;

async function submitMultiplayerRequest(
  functionName: string,
  body: RequestBody,
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

  const res = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const responseText = await res.text();
  let json: any = null;

  try {
    json = responseText ? JSON.parse(responseText) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    console.warn(`${functionName} failed`, {
      status: res.status,
      statusText: res.statusText,
      error: json?.error ?? null,
      details: json?.details ?? null,
      rawResponse: responseText,
    });

    throw new Error(json?.error || responseText || `${functionName} failed`);
  }

  return json;
}

export async function submitOneVsOneMove(
  roomId: string,
  tile: Tile,
  branch?: string,
) {
  const { data: userData } = await supabase.auth.getUser();

  console.log('[1v1 submit before fetch]', {
    roomId,
    tokenUserId: userData.user?.id ?? null,
    tileId: tile?.id ?? null,
    branch: branch ?? null,
  });

  return submitMultiplayerRequest('submit_one_vs_one', {
    action: 'move',
    room_id: roomId,
    tile,
    branch,
  });
}

export async function submitOneVsOnePass(roomId: string) {
  return submitMultiplayerRequest('submit_one_vs_one', {
    action: 'pass',
    room_id: roomId,
  });
}

export async function submitOneVsOneDraw(roomId: string) {
  return submitMultiplayerRequest('submit_one_vs_one', {
    action: 'draw',
    room_id: roomId,
  });
}

export async function submitTwoVsTwoMove(
  roomId: string,
  tile: Tile,
  branch?: string,
) {
  return submitMultiplayerRequest('submit_two_vs_two', {
    action: 'move',
    room_id: roomId,
    tile,
    branch,
  });
}

export async function submitTwoVsTwoPass(roomId: string) {
  return submitMultiplayerRequest('submit_two_vs_two', {
    action: 'pass',
    room_id: roomId,
  });
}
