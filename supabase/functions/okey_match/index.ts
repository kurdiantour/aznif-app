import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  projectOkeyMatchState,
  type OkeyAuthoritativeCommand,
  type OkeyAuthoritativeMatchState,
  type OkeyMatchServerProjection,
} from "../../../okey/server/okey-authoritative.ts";

import type {
  OkeyMeld,
} from "../../../okey/types/okey.ts";
import {
  type OkeyActionEvent,
} from "../../../okey/server/okey-action-events.ts";
import {
  reconcileAuthoritativeHumanCommand,
} from "../../../okey/server/okey-server-reconciler.ts";
import { deterministicCommandId } from "../_shared/deterministic-command-id.ts";
import { scheduleAznifGameLifecycle } from "../_shared/aznif-game-lifecycle.ts";

type OkeyAuthoritativeBundle = {
  state: OkeyAuthoritativeMatchState;
  player_index: number;
  version: number;
  turn_deadline_at: string | null;
  command_applied: boolean;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  const responseBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? { ...body, serverNow: new Date().toISOString() }
      : body;
  return new Response(JSON.stringify(responseBody), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function parseCommand(
  value: unknown,
): OkeyAuthoritativeCommand | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const command = value as Record<string, unknown>;

  switch (command.type) {
    case "draw":
      return command.source === "deck" ||
          command.source === "discard"
        ? {
            type: "draw",
            source: command.source,
          }
        : null;

    case "discard":
      return typeof command.tileId === "string"
        ? {
            type: "discard",
            tileId: command.tileId,
          }
        : null;

    case "declare-konkan":
      return Array.isArray(command.orderedRunTileIds) &&
          command.orderedRunTileIds.every((id) => typeof id === "string") &&
          Array.isArray(command.completionMeldTileIds) &&
          command.completionMeldTileIds.every((id) => typeof id === "string") &&
          typeof command.discardTileId === "string"
        ? {
            type: "declare-konkan",
            orderedRunTileIds: command.orderedRunTileIds as string[],
            completionMeldTileIds: command.completionMeldTileIds as string[],
            discardTileId: command.discardTileId,
          }
        : null;

    case "open-melds":
      return Array.isArray(command.melds) &&
          typeof command.score === "number" &&
          Number.isFinite(command.score)
        ? {
            type: "open-melds",
            melds: command.melds as OkeyMeld[],
            score: command.score,
          }
        : null;

    case "open-and-discard":
      return Array.isArray(command.melds) &&
          typeof command.score === "number" && Number.isFinite(command.score) &&
          typeof command.tileId === "string"
        ? { type: "open-and-discard", melds: command.melds as OkeyMeld[], score: command.score, tileId: command.tileId }
        : null;

    case "spend-meld":
    case "lock-konkan":
      return typeof command.tileId === "string" &&
          typeof command.targetPlayerId === "string" &&
          typeof command.targetMeldId === "string" &&
          (command.runEnd === undefined || command.runEnd === "start" || command.runEnd === "end")
        ? {
            type: command.type,
            tileId: command.tileId,
            targetPlayerId: command.targetPlayerId,
            targetMeldId: command.targetMeldId,
            ...(command.runEnd ? { runEnd: command.runEnd } : {}),
          }
        : null;

    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return json(
      {
        error: "method_not_allowed",
      },
      405,
    );
  }

  const supabaseUrl =
    Deno.env.get("SUPABASE_URL");

  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY");

  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const lifecycleSecret = Deno.env.get("AZNIF_LIFECYCLE_SECRET");
  const schedulerUrl = Deno.env.get("AZNIF_GAME_LIFECYCLE_URL");

  const authorization =
    req.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(
      {
        error: "server_not_configured",
      },
      500,
    );
  }

  if (!authorization) {
    return json(
      {
        error: "unauthorized",
      },
      401,
    );
  }

  const authClient = createClient(
    supabaseUrl,
    anonKey,
    {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    },
  );

  const {
    data: authData,
    error: authError,
  } = await authClient.auth.getUser();

  if (authError || !authData.user) {
    return json(
      {
        error: "unauthorized",
      },
      401,
    );
  }

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return json(
      {
        error: "invalid_json",
      },
      400,
    );
  }

  const action = String(body.action ?? "");

  if (
    action !== "snapshot" &&
    action !== "command" &&
    action !== "manual-leave"
  ) {
    return json(
      {
        error: "invalid_action",
      },
      400,
    );
  }

  if (!isUuid(body.matchId)) {
    return json(
      {
        error: "invalid_match_id",
      },
      400,
    );
  }

  const matchId = body.matchId;
  const isSnapshot = action === "snapshot";

  if (
    !isSnapshot &&
    !isUuid(body.commandId)
  ) {
    return json(
      {
        error: "invalid_command_envelope",
      },
      400,
    );
  }

  const service = createClient(
    supabaseUrl,
    serviceKey,
    {
      auth: {
        persistSession: false,
      },
    },
  );

  const broadcastStateUpdate = async (
    commandId: string,
    version: number,
    publicProjection: OkeyMatchServerProjection,
    actionEvents: OkeyActionEvent[] = [],
  ) => {
    const channel = service.channel(
      `okey-match:${matchId}`,
    );

    await channel.send({
      type: "broadcast",
      event: "state_update",
      payload: {
        matchId,
        commandId,
        version,
        publicProjection,
        actionEvents,
      },
    });

    await service.removeChannel(channel);
  };

  const { data: runtimeMatch, error: runtimeMatchError } = await service
    .schema("okey")
    .from("matches")
    .select("is_test")
    .eq("id", matchId)
    .maybeSingle();
  if (runtimeMatchError || !runtimeMatch) {
    return json({ error: "match_runtime_lookup_failed" }, 500);
  }
  const isTestMatch = runtimeMatch.is_test === true;


  const loadManualLeaveBundle = async (): Promise<OkeyAuthoritativeBundle | null> => {
    const [matchResult, seatResult, privateStateResult, commandResult] = await Promise.all([
      service
        .schema("okey")
        .from("matches")
        .select("version,status,turn_deadline_at")
        .eq("id", matchId)
        .maybeSingle(),
      service
        .schema("okey")
        .from("match_seats")
        .select("player_index")
        .eq("match_id", matchId)
        .eq("user_id", authData.user.id)
        .maybeSingle(),
      service
        .schema("okey")
        .from("match_private_states")
        .select("state")
        .eq("match_id", matchId)
        .maybeSingle(),
      service
        .schema("okey")
        .from("match_commands")
        .select("command_id")
        .eq("match_id", matchId)
        .eq("command_id", body.commandId)
        .maybeSingle(),
    ]);

    if (
      matchResult.error || !matchResult.data ||
      seatResult.error || !seatResult.data ||
      privateStateResult.error || !privateStateResult.data ||
      commandResult.error
    ) {
      return null;
    }

    return {
      version: Number(matchResult.data.version),
      turn_deadline_at: matchResult.data.turn_deadline_at ?? null,
      player_index: Number(seatResult.data.player_index),
      state: privateStateResult.data.state as OkeyAuthoritativeMatchState,
      command_applied: Boolean(commandResult.data),
    };
  };

let bundle: OkeyAuthoritativeBundle | null = null;
let bundleError: unknown = null;

if (action === "manual-leave") {
  bundle = await loadManualLeaveBundle();
} else {
  const bundleResult = await service
    .rpc("okey_get_authoritative_bundle", {
      p_match_id: matchId,
      p_user_id: authData.user.id,
      p_command_id: isSnapshot ? null : body.commandId,
    })
    .single();
  bundle = bundleResult.data as OkeyAuthoritativeBundle | null;
  bundleError = bundleResult.error;
}

  if (bundleError || !bundle) {
    return json(
      {
        error: "match_not_found_or_forbidden",
      },
      404,
    );
  }

  
  const state =
    bundle.state as OkeyAuthoritativeMatchState;

  const playerIndex =
    bundle.player_index as number;

  const projectForViewer = (
    matchState: OkeyAuthoritativeMatchState,
    version: number,
    turnDeadlineAt: string | null,
  ) => projectOkeyMatchState(
    matchState,
    playerIndex,
    version,
    turnDeadlineAt,
  );

  const hasManuallyLeft =
    (state.manualLeftPlayerIds ?? [])
      .includes(authData.user.id);

  if (
    hasManuallyLeft &&
    !(
      action === "manual-leave" &&
      bundle.command_applied
    )
  ) {
    return json(
      { error: "manual_leave_is_final" },
      403,
    );
  }

  /*
   * Snapshot is strictly read-only. It only returns authoritative state,
   * missed action events, server time, and the viewer projection.
   *
   * It never advances Bot / Timeout / Ghost / Next-Round lifecycle and never
   * retries settlement or performs any other authoritative side effect.
   */
  if (isSnapshot) {
    const currentState = state;
    const currentVersion = Number(bundle.version);
    const currentDeadline = bundle.turn_deadline_at;

    const afterVersion = Number(body.afterVersion);
    let actionEvents: OkeyActionEvent[] = [];
    if (Number.isSafeInteger(afterVersion) && afterVersion >= 0) {
      const { data: eventRows, error: eventError } = await service
        .schema("okey")
        .from("match_action_events")
        .select("match_id,version,sequence,action_type,actor_player_id,payload,created_at")
        .eq("match_id", matchId)
        .gt("version", afterVersion)
        .order("version", { ascending: true })
        .order("sequence", { ascending: true });
      if (eventError) throw eventError;
      actionEvents = (eventRows ?? []).map((row) => ({
        matchId: row.match_id,
        version: Number(row.version),
        sequence: Number(row.sequence),
        type: row.action_type,
        actorPlayerId: row.actor_player_id,
        payload: row.payload ?? {},
        createdAt: row.created_at,
      })) as OkeyActionEvent[];
    }

    return json({
      settlement: null,
      actionEvents,
      projection: projectForViewer(
        currentState,
        currentVersion,
        currentDeadline,
      ),
    });
  }

  const clientExpectedVersion =
    body.expectedVersion !== undefined && body.expectedVersion !== null
      ? Number(body.expectedVersion)
      : null;
  const humanResult = await reconcileAuthoritativeHumanCommand({
    action: action as "command" | "manual-leave",
    matchId,
    actorUserId: authData.user.id,
    commandId: body.commandId as string,
    command: action === "command" ? parseCommand(body.command) : null,
    clientExpectedVersion,
    commandReceivedAtMs: Date.now(),
    bundle,
    isTestMatch,
  }, {
    client: service,
    deterministicCommandId,
    reloadManualLeaveBundle: loadManualLeaveBundle,
    broadcastStateUpdate: async (payload) => broadcastStateUpdate(
      payload.commandId,
      payload.version,
      payload.publicProjection,
      payload.actionEvents,
    ),
    dispatchLifecycleWakeup: async (wakeup) => {
      if (!lifecycleSecret || !schedulerUrl) return;
      await scheduleAznifGameLifecycle({
        schedulerUrl,
        lifecycleSecret,
        gameType: "okey",
        matchId: wakeup.matchId,
        expectedVersion: wakeup.version,
        runAt: wakeup.runAt,
      });
    },
  });
  if (!humanResult.ok) {
    if (humanResult.error === "settlement_failed" && humanResult.commit) {
      return json({
        error: humanResult.error,
        details: humanResult.details,
        committed: true,
        version: humanResult.commit.version,
        projection: projectForViewer(
          humanResult.commit.state,
          humanResult.commit.version,
          humanResult.commit.turn_deadline_at,
        ),
      }, 500);
    }
    return json(
      { error: humanResult.error, ...(humanResult.details ? { details: humanResult.details } : {}) },
      humanResult.status,
    );
  }
  const commit = humanResult.commit;
  const commandSettlement = humanResult.settlement;
  if (humanResult.duplicate) {
    return json({
      applied: true,
      settlement: commandSettlement,
      projection: projectForViewer(
        commit.state,
        commit.version,
        commit.turn_deadline_at,
      ),
    });
  }

  const finalState = humanResult.state;
  const finalVersion = humanResult.version;
  const finalDeadline = humanResult.turnDeadlineAt;
  const finalActionEvents = humanResult.actionEvents;

  const finalProjection = projectForViewer(
    finalState,
    finalVersion,
    finalDeadline,
  );

  if (finalState.matchFinished) {
    return json({
      applied: commit.applied,
      actionEvents: finalActionEvents,
      settlement: commandSettlement,
      projection: finalProjection,
    });
  }

  return json({
    applied: commit.applied,
    actionEvents: finalActionEvents,
    projection: finalProjection,
  });
});
