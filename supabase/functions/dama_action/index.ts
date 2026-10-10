import { createClient } from "jsr:@supabase/supabase-js@2";
import { chooseBotMove } from "../../../dama/bot.ts";
import { applyMove, isTurnExpired, resolveTurnTimeout, type GameState, type Move } from "../../../dama/engine.ts";

const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) throw new Error("Missing Supabase server configuration");
const service = createClient(url, serviceKey, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);
    const { data: auth, error: authError } = await service.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid auth token" }, 401);

    const body = await request.json();
    const matchId = typeof body.match_id === "string" ? body.match_id : "";
    const action = body.action;
    if (!matchId || !["move", "timeout", "bot"].includes(action)) return json({ error: "Invalid command" }, 400);

    const [{ data: match, error: matchError }, { data: players, error: playersError }] = await Promise.all([
      service.from("dama_matches").select("id,status,version,state,current_turn_user_id").eq("id", matchId).maybeSingle(),
      service.from("dama_match_players").select("user_id,piece_color,bot_takeover,connected,left_at,last_seen_at").eq("match_id", matchId).is("left_at", null),
    ]);
    if (matchError) throw matchError;
    if (playersError) throw playersError;
    if (!match) return json({ error: "Match not found" }, 404);
    const requester = (players ?? []).find((player: any) => player.user_id === auth.user.id);
    if (!requester) return json({ error: "You are not a player in this match" }, 403);
    if (match.status !== "active" || !match.state) return json({ error: "Match is not active", match }, 409);

    const state = match.state as GameState;
    const expectedVersion = Number(body.expected_version);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(match.version)) {
      return json({ error: "Match state is stale", code: "stale_dama_state", version: match.version }, 409);
    }

    let next: GameState;
    let actorId = auth.user.id;
    let committedAction: string;
    let payload: Record<string, unknown> = {};

    if (action === "move") {
      if (match.current_turn_user_id !== auth.user.id || requester.piece_color !== state.turn) {
        return json({ error: "Not your turn" }, 403);
      }
      if (isTurnExpired(state, Date.now())) return json({ error: "Turn expired", code: "turn_expired" }, 409);
      const move = body.move as Move;
      next = applyMove(state, move, Date.now());
      committedAction = "move";
      payload = { move };
    } else if (action === "timeout") {
      if (!isTurnExpired(state, Date.now())) return json({ error: "Turn has not expired", code: "turn_not_expired" }, 409);
      next = resolveTurnTimeout(state, Date.now());
      committedAction = "timeout-move";
      actorId = match.current_turn_user_id;
      payload = { timedOutUserId: match.current_turn_user_id };
    } else {
      const turnPlayer = (players ?? []).find((player: any) => player.user_id === match.current_turn_user_id);
      if (!turnPlayer?.bot_takeover) return json({ error: "Bot does not control this turn" }, 403);
      const move = chooseBotMove(state);
      if (!move) return json({ error: "No legal Dama move" }, 409);
      next = applyMove(state, move, Date.now());
      committedAction = "bot-move";
      actorId = match.current_turn_user_id;
      payload = { move, reason: "bot_takeover" };
    }

    const nextPlayer = (players ?? []).find((player: any) => player.piece_color === next.turn && !player.left_at);
    const { data: committed, error: commitError } = await service.rpc("commit_dama_action", {
      p_match_id: matchId,
      p_expected_version: expectedVersion,
      p_actor_user_id: actorId,
      p_state: next,
      p_current_turn_user_id: next.result ? null : nextPlayer?.user_id ?? null,
      p_action: committedAction,
      p_payload: payload,
    });
    if (commitError) {
      if (commitError.message?.includes("STALE_DAMA_STATE")) return json({ error: "Match state is stale", code: "stale_dama_state" }, 409);
      throw commitError;
    }
    return json({ ok: true, match: committed, serverNow: Date.now() });
  } catch (error) {
    console.error("dama_action failed", error);
    return json({ error: error instanceof Error ? error.message : "Dama command failed" }, 500);
  }
});
