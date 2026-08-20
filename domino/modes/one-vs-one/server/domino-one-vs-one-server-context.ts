export type AuthenticatedOneVsOneRequest =
  | { ok: true; user: any }
  | { ok: false; response: Response };

export function dominoOneVsOneJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function authenticateDominoOneVsOneRequest(
  request: Request,
  client: any,
): Promise<AuthenticatedOneVsOneRequest> {
  const token = (request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return { ok: false, response: dominoOneVsOneJson({ error: "Unauthorized" }, 401) };
  }

  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, response: dominoOneVsOneJson({ error: "Invalid auth token" }, 401) };
  }
  return { ok: true, user: data.user };
}

export function loadDominoOneVsOneRoom(client: any, roomId: string) {
  return client.from("one_vs_one_rooms")
    .select("id, status, state, version, current_turn_player_id, updated_at")
    .eq("id", roomId)
    .maybeSingle();
}

export function loadDominoOneVsOnePlayers(client: any, roomId: string) {
  return client.from("one_vs_one_players")
    .select("id, user_id, player_index, seat, team_id, kind")
    .eq("room_id", roomId)
    .order("player_index", { ascending: true });
}

export function loadDominoOneVsOnePrivateState(client: any, roomId: string) {
  return client.from("one_vs_one_private_states")
    .select("hands, boneyard")
    .eq("room_id", roomId)
    .maybeSingle();
}

export function projectDominoOneVsOnePrivateState(args: {
  state: any;
  hands: any[][];
  playerIndex: number;
  userId?: string;
  revealFinalHands?: boolean;
}) {
  return {
    ...args.state,
    myHand: args.hands[args.playerIndex] ?? [],
    ...(args.userId ? { myHandOwnerId: args.userId } : {}),
    ...(args.revealFinalHands
      ? { revealedFinalHands: args.state.roundWinnerPlayerId ? args.hands : null }
      : {}),
  };
}
