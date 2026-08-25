import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
  projectOkeyMatchPublicState,
  type OkeyServerPlayerIdentity,
} from "../../../okey/server/okey-authoritative.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const randomPassword = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(48)), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !anon || !serviceKey) {
    return json({ error: "server_configuration_incomplete" }, 503);
  }
  if (!authorization) return json({ error: "unauthorized" }, 401);

  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json({ error: "unauthorized" }, 401);

  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("username, is_admin")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) {
    return json({ error: "profile_lookup_failed", details: profileError.message }, 500);
  }
  if (!profile?.is_admin) return json({ error: "admin_test_access_required" }, 403);

  const { data: active, error: activeError } = await service
    .schema("okey").from("matches").select("id")
    .eq("created_by", authData.user.id).eq("is_test", true)
    .in("status", ["waiting", "playing"])
    .order("updated_at", { ascending: false }).limit(5);
  if (activeError) {
    return json({ error: "active_test_match_lookup_failed", details: activeError.message }, 500);
  }
  for (const match of active ?? []) {
    const { data: seat } = await service.schema("okey").from("match_seats")
      .select("membership_released_at").eq("match_id", match.id)
      .eq("user_id", authData.user.id).maybeSingle();
    if (seat && !seat.membership_released_at) {
      return json({ matchId: match.id, resumed: true });
    }
  }

  const { data: configured, error: configuredError } = await service
    .schema("okey").from("test_bot_accounts")
    .select("slot, user_id").order("slot");
  if (configuredError) {
    return json({ error: "test_bot_lookup_failed", details: configuredError.message }, 500);
  }
  const bots = new Map<number, string>(
    (configured ?? []).map((row) => [Number(row.slot), String(row.user_id)]),
  );
  for (let slot = 1; slot <= 3; slot += 1) {
    if (bots.has(slot)) continue;
    const { data: created, error } = await service.auth.admin.createUser({
      email: `okey-test-bot-${slot}@internal.invalid`,
      password: randomPassword(),
      email_confirm: true,
      app_metadata: {
        system_account: true,
        okey_test_bot: true,
        okey_test_bot_slot: slot,
      },
      user_metadata: { username: `Test Bot ${slot}` },
    });
    if (error || !created.user) {
      return json({ error: "test_bot_provision_failed", slot, details: error?.message }, 500);
    }
    const registered = await service.schema("okey").from("test_bot_accounts")
      .insert({ slot, user_id: created.user.id });
    if (registered.error) {
      await service.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      return json({
        error: "test_bot_registration_failed",
        slot,
        details: registered.error.message,
      }, 500);
    }
    bots.set(slot, created.user.id);
  }

  const botIds = [1, 2, 3].map((slot) => bots.get(slot)!);
  const identities = [
    { id: authData.user.id, name: profile.username ?? "Test Player" },
    ...botIds.map((id, index) => ({
      id,
      name: `Test Bot ${index + 1}`,
      controlledByBot: true,
      botDifficulty: "normal" as const,
      botNumber: index + 1,
    })),
  ] as [
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
  ];
  const state = createAuthoritativeOkeyMatch(identities);
  const deadline = getNextOkeyMatchTurnDeadline(state);
  const projection = projectOkeyMatchPublicState(state, 0, deadline);
  const created = await service.rpc("okey_create_preview_test_match", {
    p_owner_user_id: authData.user.id,
    p_bot_user_ids: botIds,
    p_state: state,
    p_projection: projection,
    p_turn_deadline_at: deadline,
  });
  if (created.error || typeof created.data !== "string") {
    return json({
      error: "test_match_creation_failed",
      details: created.error?.message,
    }, 500);
  }

  const matchId = created.data;
  const channel = service.channel(`okey-match:${matchId}`);
  await channel.send({
    type: "broadcast",
    event: "state_update",
    payload: { matchId, version: 0 },
  });
  await service.removeChannel(channel);
  return json({ matchId, resumed: false }, 201);
});
