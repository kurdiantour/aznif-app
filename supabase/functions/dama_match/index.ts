import { createClient } from "jsr:@supabase/supabase-js@2";
import { scheduleDamaLifecycle } from "../_shared/dama-lifecycle.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") ?? "";
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!token || !anonKey) return json({ error: "unauthorized" }, 401);
    const { data: auth, error: authError } = await service.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const body = await request.json().catch(() => ({}));
    if (body?.action === "leave" || body?.action === "restore") {
      if (typeof body.match_id !== "string") return json({ error: "invalid_match_id" }, 400);
      const rpcName = body.action === "leave" ? "dama_leave_match" : "dama_restore_control";
      const { error: actionError } = await userClient.rpc(rpcName, { p_match_id: body.match_id });
      if (actionError) {
        // A previous restore may have committed before its lifecycle schedule
        // failed. Let that same member retry the scheduling path idempotently.
        if (body.action !== "restore" || !actionError.message.includes("dama_timeout_takeover_not_restorable")) {
          return json({ error: actionError.message }, 409);
        }
        const { data: seat, error: seatError } = await service.from("dama_match_players")
          .select("user_id,bot_takeover,manual_left,left_at")
          .eq("match_id", body.match_id).eq("user_id", auth.user.id).is("left_at", null).maybeSingle();
        if (seatError) throw seatError;
        if (!seat || seat.manual_left || seat.bot_takeover) return json({ error: actionError.message }, 409);
      }
      const [{ data: match, error: matchError }, { data: players, error: playersError }] = await Promise.all([
        service.from("dama_matches").select("id,status,version,state,current_turn_user_id").eq("id", body.match_id).single(),
        service.from("dama_match_players").select("user_id,bot_profile_id,piece_color,bot_takeover").eq("match_id", body.match_id).is("left_at", null),
      ]);
      if (matchError) throw matchError;
      if (playersError) throw playersError;
      const nextRunAt = await scheduleDamaLifecycle({ service, matchId: body.match_id, state: match.state, status: match.status,
        version: Number(match.version), currentTurnUserId: match.current_turn_user_id, players: players ?? [] });
      return json({ ok: true, action: body.action, match_id: body.match_id, status: match.status, version: match.version, nextRunAt });
    }
    const { data, error } = await userClient.rpc("find_dama_match");
    if (error) {
      const insufficient = error.message.includes("insufficient_entry_balance");
      return json({ error: insufficient ? "insufficient_entry_balance" : "matchmaking_failed", details: error.message }, 409);
    }
    if (data?.status === "matched" || data?.status === "active") {
      const matchId = String(data.match_id);
      const [{ data: match, error: matchError }, { data: players, error: playersError }] = await Promise.all([
        service.from("dama_matches").select("id,status,version,state,current_turn_user_id,countdown_deadline_at,matchmaking_deadline_at").eq("id", matchId).single(),
        service.from("dama_match_players").select("user_id,bot_profile_id,piece_color,bot_takeover").eq("match_id", matchId).is("left_at", null),
      ]);
      if (matchError) throw matchError;
      if (playersError) throw playersError;
      try {
        await scheduleDamaLifecycle({ service, matchId, state: match.state, status: match.status, version: Number(match.version),
          currentTurnUserId: match.current_turn_user_id, players: players ?? [] });
      } catch (error) {
        console.error("Dama initial lifecycle schedule failed", { matchId, error });
        const { error: refundError } = await service.rpc("dama_cancel_and_refund", {
          p_match_id: matchId, p_reason: "lifecycle_start_failed",
        });
        if (refundError) console.error("Dama start refund failed", { matchId, refundError });
        return json({ error: "lifecycle_schedule_failed", match_id: matchId, committed: true }, 503);
      }
    }
    if (data?.status === "searching") {
      const matchId = String(data.match_id);
      const [{ data: match, error: matchError }, { data: players, error: playersError }] = await Promise.all([
        service.from("dama_matches").select("id,status,version,state,current_turn_user_id,matchmaking_deadline_at").eq("id", matchId).single(),
        service.from("dama_match_players").select("user_id,bot_profile_id,bot_takeover,piece_color").eq("match_id", matchId).is("left_at", null),
      ]);
      if (matchError) throw matchError;
      if (playersError) throw playersError;
      await scheduleDamaLifecycle({ service, matchId, state: match.state, status: match.status, version: Number(match.version),
        currentTurnUserId: match.current_turn_user_id, players: players ?? [] });
      data.matchmaking_deadline_at = match.matchmaking_deadline_at;
    }
    return json(data);
  } catch (error) {
    console.error("dama_match failed", error);
    return json({ error: error instanceof Error ? error.message : "matchmaking_failed" }, 500);
  }
});
