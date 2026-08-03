import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  applyAuthoritativeOkeyCommand,
  getNextOkeyTurnDeadline,
  OkeyCommandError,
  projectOkeyPublicState,
  projectOkeyState,
  resolveAuthoritativeDeadline,
  type OkeyAuthoritativeCommand,
} from "../../../okey/server/okey-authoritative.ts";
import type { OkeyGameState, OkeyMeld } from "../../../okey/types/okey.ts";

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

function parseCommand(value: unknown): OkeyAuthoritativeCommand | null {
  if (!value || typeof value !== "object") return null;
  const command = value as Record<string, unknown>;
  switch (command.type) {
    case "draw":
      return command.source === "deck" || command.source === "discard"
        ? { type: "draw", source: command.source }
        : null;
    case "discard":
      return typeof command.tileId === "string" ? { type: "discard", tileId: command.tileId } : null;
    case "declare-konkan":
      return { type: "declare-konkan" };
    case "open-melds":
      return Array.isArray(command.melds) && typeof command.score === "number"
        ? { type: "open-melds", melds: command.melds as OkeyMeld[], score: command.score }
        : null;
    case "spend-meld":
    case "lock-konkan":
      return typeof command.tileId === "string" && typeof command.targetPlayerId === "string" && typeof command.targetMeldId === "string"
        ? { type: command.type, tileId: command.tileId, targetPlayerId: command.targetPlayerId, targetMeldId: command.targetMeldId }
        : null;
    default:
      return null;
  }
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
  if (!isUuid(body.matchId)) return json({ error: "invalid_match_id" }, 400);
  const isSnapshot = body.action === "snapshot";
  if (!isSnapshot && (!isUuid(body.commandId) || typeof body.expectedVersion !== "number" || !Number.isSafeInteger(body.expectedVersion))) {
    return json({ error: "invalid_command_envelope" }, 400);
  }

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: bundle, error: bundleError } = await service.rpc("okey_get_authoritative_bundle", {
    p_match_id: body.matchId,
    p_user_id: authData.user.id,
    p_command_id: isSnapshot ? null : body.commandId,
  }).single();
  if (bundleError || !bundle) return json({ error: "match_not_found_or_forbidden" }, 404);

  const match = bundle;
  const seat = { player_index: bundle.player_index };
  const state = bundle.state as OkeyGameState;
  if (isSnapshot) {
    return json({ projection: projectOkeyState(state, seat.player_index, match.version, match.turn_deadline_at) });
  }
  if (bundle.command_applied) {
    return json({
      applied: false,
      projection: projectOkeyState(state, seat.player_index, match.version, match.turn_deadline_at),
    });
  }

  let nextState: OkeyGameState;
  let commandType: string;
  try {
    if (body.action === "resolve-timeout") {
      nextState = resolveAuthoritativeDeadline(state, match.turn_deadline_at);
      commandType = "system-timeout";
    } else if (body.action === "command") {
      if (match.turn_deadline_at && Date.parse(match.turn_deadline_at) <= Date.now()) {
        return json({ error: "turn_deadline_expired" }, 409);
      }
      const command = parseCommand(body.command);
      if (!command) return json({ error: "invalid_command" }, 400);
      nextState = applyAuthoritativeOkeyCommand(state, seat.player_index, command);
      commandType = command.type;
    } else {
      return json({ error: "invalid_action" }, 400);
    }
  } catch (error) {
    if (error instanceof OkeyCommandError) return json({ error: error.code }, 409);
    return json({ error: "engine_failure" }, 500);
  }

  const nextVersion = match.version + 1;
  const deadline = getNextOkeyTurnDeadline(nextState);
  const publicProjection = projectOkeyPublicState(nextState, nextVersion, deadline);
  const { data: commit, error: commitError } = await service.rpc("okey_commit_authoritative_command", {
    p_match_id: body.matchId,
    p_user_id: authData.user.id,
    p_command_id: body.commandId,
    p_expected_version: body.expectedVersion,
    p_command_type: commandType,
    p_state: nextState,
    p_projection: publicProjection,
    p_status: nextState.phase === "finished" ? "finished" : "playing",
    p_turn_deadline_at: deadline,
  }).single();
  if (commitError || !commit) {
    const conflict = commitError?.message.includes("version_conflict") ?? false;
    return json({ error: conflict ? "version_conflict" : "commit_failed" }, conflict ? 409 : 500);
  }

  const channel = service.channel(`okey-match:${body.matchId}`);
  await channel.send({
    type: "broadcast", event: "invalidate", payload: { matchId: body.matchId, version: commit.version },
  });
  await service.removeChannel(channel);

  return json({
    applied: commit.applied,
    projection: projectOkeyState(commit.state as OkeyGameState, seat.player_index, commit.version, commit.turn_deadline_at),
  });
});
