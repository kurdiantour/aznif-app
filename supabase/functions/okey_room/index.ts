import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  createAuthoritativeOkeyGame,
  getNextOkeyTurnDeadline,
  projectOkeyPublicState,
} from "../../../okey/server/okey-authoritative.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "server_not_configured" }, 500);
  if (!authorization) return json({ error: "unauthorized" }, 401);

  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const action = body.action;
  if (!['matchmake', 'status', 'heartbeat', 'reconnect', 'leave'].includes(String(action))) {
    return json({ error: "invalid_action" }, 400);
  }
  if (action === "matchmake" && (typeof body.tableId !== "string" || body.tableId.length === 0 || body.tableId.length > 64)) {
    return json({ error: "invalid_table" }, 400);
  }
  if (action !== "matchmake" && !isUuid(body.matchId)) return json({ error: "invalid_match_id" }, 400);

  const metadata = authData.user.user_metadata ?? {};
  const displayName = String(metadata.display_name ?? metadata.full_name ?? metadata.name ?? "Player").slice(0, 64);
  const avatarUrl = typeof metadata.avatar_url === "string" ? metadata.avatar_url : null;
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const callRoomAction = (roomAction: string, extra: Record<string, unknown> = {}) => service.rpc("okey_room_action", {
    p_user_id: authData.user.id,
    p_action: roomAction,
    p_match_id: body.matchId ?? null,
    p_table_id: body.tableId ?? null,
    p_display_name: displayName,
    p_avatar_url: avatarUrl,
    p_state: null,
    p_projection: null,
    p_turn_deadline_at: null,
    ...extra,
  });

  let { data: room, error: roomError } = await callRoomAction(String(action));
  if (roomError || !room) return json({ error: roomError?.message ?? "room_action_failed" }, 409);

  let startedMatch = false;
  if (room.shouldStart) {
    const members = [...room.members].sort((left, right) => left.playerIndex - right.playerIndex);
    if (members.length === 4) {
      const identities = members.map((member) => ({ id: member.userId, name: member.displayName }));
      const state = createAuthoritativeOkeyGame(identities as [typeof identities[0], typeof identities[0], typeof identities[0], typeof identities[0]]);
      const deadline = getNextOkeyTurnDeadline(state);
      const projection = projectOkeyPublicState(state, 0, deadline);
      const started = await callRoomAction("start", {
        p_match_id: room.matchId,
        p_state: state,
        p_projection: projection,
        p_turn_deadline_at: deadline,
      });
      if (!started.error && started.data) {
        room = started.data;
        startedMatch = true;
      }
      else {
        const refreshed = await callRoomAction("status", { p_match_id: room.matchId });
        if (refreshed.data) room = refreshed.data;
      }
    }
  }

  if (action !== "status" && action !== "heartbeat" || startedMatch) {
    const channel = service.channel(`okey-room:${room.matchId}`);
    await channel.send({ type: "broadcast", event: "invalidate", payload: { matchId: room.matchId, status: room.status } });
    await service.removeChannel(channel);
  }
  return json({ room });
});
