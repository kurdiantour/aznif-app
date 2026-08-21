export function dominoTwoVsTwoJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function authenticateDominoTwoVsTwoRequest(request: Request, client: any) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { response: dominoTwoVsTwoJson({ error: 'Unauthorized' }, 401) } as const;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    return { response: dominoTwoVsTwoJson({ error: 'Invalid auth token' }, 401) } as const;
  }
  return { user: data.user, token } as const;
}

export const loadDominoTwoVsTwoRoom = (client: any, roomId: string) =>
  client.from('two_vs_two_rooms')
    .select('id, status, state, version, current_turn_player_id, updated_at')
    .eq('id', roomId).maybeSingle();

export const loadDominoTwoVsTwoPlayers = (client: any, roomId: string) =>
  client.from('two_vs_two_players')
    .select('id, user_id, player_index, seat, team_id, kind, connected, bot_takeover, abandoned')
    .eq('room_id', roomId).order('player_index', { ascending: true });

export const loadDominoTwoVsTwoPrivateState = (client: any, roomId: string) =>
  client.from('two_vs_two_private_states').select('hands, boneyard').eq('room_id', roomId).maybeSingle();
