import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  applyAuthoritativeOkeyMatchCommand,
  applyAuthoritativeOkeyEliminatedTurn,
  applyAuthoritativeManualLeave,
  deriveOkeyDailyQuestGameplayEvents,
  getOkeyMatchTurnDeadlineAfterTransition,
  OkeyCommandError,
  projectOkeyMatchPublicState,
  projectOkeyMatchState,
  resolveAuthoritativeMatchDeadline,
  startAuthoritativeOkeyNextRound,
  type OkeyAuthoritativeCommand,
  type OkeyAuthoritativeMatchState,
} from "../../../okey/server/okey-authoritative.ts";

import type {
  OkeyMeld,
} from "../../../okey/types/okey.ts";
import {
  createForcedDrawDiscardEvents,
  createOkeyCommandActionEvents,
  type OkeyActionEvent,
  type OkeyActionEventDraft,
} from "../../../okey/server/okey-action-events.ts";
import { handOffOkeyBotTurn } from "../_shared/okey-bot-handoff.ts";

type OkeyAuthoritativeBundle = {
  state: OkeyAuthoritativeMatchState;
  player_index: number;
  version: number;
  turn_deadline_at: string | null;
  command_applied: boolean;
};

type OkeyAuthoritativeCommit = {
  applied: boolean;
  version: number;
  state: OkeyAuthoritativeMatchState;
  turn_deadline_at: string | null;
  action_events?: OkeyActionEvent[];
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
      return Array.isArray(command.orderedRunTileIds)
        ? {
            type: "declare-konkan",
            orderedRunTileIds: command.orderedRunTileIds,
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

  const workerSecret =
    Deno.env.get("OKEY_WORKER_SECRET");

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
    action !== "play-eliminated" &&
    action !== "start-next-round" &&
    action !== "resolve-timeout" &&
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
    version: number,
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
        version,
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

  const settleFinishedState = async (
    state: OkeyAuthoritativeMatchState,
  ) => {
    if (!state.matchFinished) {
      return {
        settlement: null,
        error: null,
      };
    }

    if (isTestMatch) {
      const testSettlement = {
        type: "test",
        economyApplied: false,
        winnerTeamId: state.matchWinnerTeamId,
      };
      const { error: testSettlementError } = await service
        .schema("okey")
        .from("matches")
        .update({
          settlement_at: new Date().toISOString(),
          settlement: testSettlement,
        })
        .eq("id", matchId)
        .eq("is_test", true)
        .is("settlement_at", null);
      return {
        settlement: testSettlement,
        error: testSettlementError ? new Error(testSettlementError.message) : null,
      };
    }

    const winnerTeamId =
      state.matchWinnerTeamId;

    if (!winnerTeamId && state.leaveTerminationReason !== "no-humans") {
      return {
        settlement: null,
        error: new Error("winner_team_not_found"),
      };
    }

    const {
      data: settlement,
      error: settlementError,
    } = await service.rpc(
      "okey_settle_match",
      {
        p_match_id: matchId,
        p_winner_team_id: winnerTeamId,
      },
    );

    if (settlementError) {
      return {
        settlement: null,
        error: new Error(
          settlementError.message,
        ),
      };
    }

    let playerReward: {
      pointDelta: number;
      gemDelta: number;
    } | null = null;

    if (
      settlement &&
      typeof settlement === "object" &&
      (settlement as { currency?: unknown }).currency === "fun"
    ) {
      const { data: rewardRow, error: rewardError } = await service
        .schema("okey")
        .from("fun_match_rewards")
        .select("point_delta, gem_delta")
        .eq("match_id", matchId)
        .eq("user_id", authData.user.id)
        .maybeSingle();

      if (rewardError) {
        return {
          settlement: null,
          error: new Error(rewardError.message),
        };
      }

      if (rewardRow) {
        playerReward = {
          pointDelta: Number(rewardRow.point_delta ?? 0),
          gemDelta: Number(rewardRow.gem_delta ?? 0),
        };
      }
    }

    return {
      settlement: settlement && typeof settlement === "object"
        ? { ...settlement, playerReward }
        : settlement,
      error: null,
    };
  };

const {
  data: bundleRaw,
  error: bundleError,
} = await service
  .rpc("okey_get_authoritative_bundle", {
    p_match_id: matchId,
    p_user_id: authData.user.id,
    p_command_id: isSnapshot
      ? null
      : body.commandId,
  })
  .single();

const bundle = bundleRaw as OkeyAuthoritativeBundle;

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
   * Snapshot normally only returns state.
   *
   * If a previous finished-state commit succeeded but settlement
   * temporarily failed, snapshot safely retries the idempotent
   * settlement.
   */
  if (isSnapshot) {
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
    let settlement: unknown = null;

    if (state.matchFinished) {
      const result =
        await settleFinishedState(state);

      if (result.error) {
        console.error(
          "Okey settlement recovery failed during snapshot",
          result.error,
        );
      } else {
        settlement = result.settlement;
      }
    }

    return json({
      settlement,
      actionEvents,
      projection: projectForViewer(
        state,
        bundle.version,
        bundle.turn_deadline_at,
      ),
    });
  }

  /*
   * A duplicate command must not change game state again.
   *
   * However, when the original finished command was committed but its
   * settlement failed, the duplicate request safely retries settlement.
   */
  if (bundle.command_applied) {
    let settlement: unknown = null;

    if (state.matchFinished) {
      const result =
        await settleFinishedState(state);

      if (result.error) {
        return json(
          {
            error: "settlement_recovery_failed",
            details: result.error.message,
            applied: false,
            committed: true,
            version: bundle.version,
            projection: projectForViewer(
              state,
              bundle.version,
              bundle.turn_deadline_at,
            ),
          },
          500,
        );
      }

      settlement = result.settlement;
    }

    return json({
      applied: false,
      settlement,
      actionEvents,
      projection: projectForViewer(
        state,
        bundle.version,
        bundle.turn_deadline_at,
      ),
    });
  }

  const clientExpectedVersion =
    body.expectedVersion !== undefined && body.expectedVersion !== null
      ? Number(body.expectedVersion)
      : null;

  if (
    (
      action === "command" ||
      action === "play-eliminated" ||
      action === "start-next-round"
    ) &&
    clientExpectedVersion !== null &&
    clientExpectedVersion !== Number(bundle.version)
  ) {
    return json(
      {
        error: "version_conflict",
        details: `Client expected version ${clientExpectedVersion} does not match database version ${bundle.version}`,
      },
      409,
    );
  }

  const commandReceivedAtMs = Date.now();
  let nextState: OkeyAuthoritativeMatchState;
  let commandType: string;
  const actingPlayer = state.roundState.players[state.roundState.currentPlayerIndex] ?? null;
  let actionEventDrafts: OkeyActionEventDraft[] = [];

  let acceptedCommand:
    | OkeyAuthoritativeCommand
    | { type: "manual-leave" | "system-timeout" | "system-eliminated-turn" | "start-next-round" };

  try {
    if (action === "start-next-round") {
      const expectedRound = Number(body.expectedRound);

      if (
        clientExpectedVersion === null ||
        !Number.isInteger(expectedRound) ||
        expectedRound < 1
      ) {
        return json({ error: "invalid_next_round_claim" }, 400);
      }

      if (state.matchFinished) {
        return json({ error: "match_finished" }, 409);
      }

      if (
        state.currentRound !== expectedRound ||
        state.roundState.phase !== "finished"
      ) {
        return json(
          {
            error: "already_started",
            code: "already_processed",
            version: bundle.version,
          },
          409,
        );
      }

      const eligibleAtMs = Date.parse(state.nextRoundEligibleAt ?? "");
      const serverNowMs = Date.now();
      if (!Number.isFinite(eligibleAtMs)) {
        return json({ error: "next_round_eligibility_missing" }, 409);
      }
      if (serverNowMs < eligibleAtMs) {
        return json(
          {
            error: "next_round_not_ready",
            retryAfterMs: Math.max(0, eligibleAtMs - serverNowMs),
            eligibleAt: state.nextRoundEligibleAt,
          },
          409,
        );
      }

      nextState = startAuthoritativeOkeyNextRound(state);
      commandType = "start-next-round";
      acceptedCommand = { type: "start-next-round" };
    } else if (action === "play-eliminated") {
      const expectedActorId = body.expectedActorId;
      if (
        clientExpectedVersion === null ||
        typeof expectedActorId !== "string" ||
        expectedActorId.length === 0
      ) {
        return json({ error: "invalid_eliminated_turn_claim" }, 400);
      }

      nextState = applyAuthoritativeOkeyEliminatedTurn(
        state,
        expectedActorId,
      );
      commandType = "system-eliminated-turn";
      acceptedCommand = { type: "system-eliminated-turn" };
    } else if (action === "manual-leave") {
      nextState =
        applyAuthoritativeManualLeave(
          state,
          playerIndex,
        );

      commandType = "manual-leave";
      acceptedCommand = { type: "manual-leave" };
    } else if (action === "resolve-timeout") {
      const expectedTurnDeadlineAt = body.expectedTurnDeadlineAt;
      const expectedTurnPlayerId = body.expectedTurnPlayerId;

      if (
        clientExpectedVersion === null ||
        typeof expectedTurnDeadlineAt !== "string" ||
        typeof expectedTurnPlayerId !== "string"
      ) {
        return json(
          {
            error: "stale_timeout",
            code: "stale_timeout",
            version: bundle.version,
            details: "Timeout claim is missing its turn identity",
          },
          409,
        );
      }

      if (clientExpectedVersion !== Number(bundle.version)) {
        return json(
          {
            error: clientExpectedVersion < Number(bundle.version)
              ? "already_processed"
              : "stale_timeout",
            code: clientExpectedVersion < Number(bundle.version)
              ? "already_processed"
              : "stale_timeout",
            version: bundle.version,
            expiresAt: bundle.turn_deadline_at,
            details: `Client expected version ${clientExpectedVersion} does not match database version ${bundle.version}`,
          },
          409,
        );
      }

      const currentPlayerIndex = state.roundState.currentPlayerIndex;
      const currentPlayerId = state.roundState.players[currentPlayerIndex]?.id;

      if (
        expectedTurnDeadlineAt !== bundle.turn_deadline_at ||
        expectedTurnPlayerId !== currentPlayerId
      ) {
        return json(
          {
            error: "stale_timeout",
            code: "stale_timeout",
            version: bundle.version,
            expiresAt: bundle.turn_deadline_at,
            details: "Timeout claim does not match the active turn",
          },
          409,
        );
      }

      const deadlineMs = Date.parse(bundle.turn_deadline_at ?? "");
      const serverNowMs = Date.now();
      if (!Number.isFinite(deadlineMs)) {
        return json(
          {
            error: "stale_timeout",
            code: "stale_timeout",
            version: bundle.version,
          },
          409,
        );
      }
      if (serverNowMs < deadlineMs) {
        return json(
          {
            error: "turn_timer_not_expired",
            code: "turn_timer_not_expired",
            version: bundle.version,
            expiresAt: bundle.turn_deadline_at,
            retryAfterMs: Math.max(0, deadlineMs - serverNowMs),
          },
          409,
        );
      }

      nextState =
        resolveAuthoritativeMatchDeadline(
          state,
          bundle.turn_deadline_at,
        );

      commandType = "system-timeout";
      acceptedCommand = { type: "system-timeout" };
    } else {
      if (
        bundle.turn_deadline_at &&
        Date.parse(bundle.turn_deadline_at) <=
          Date.now()
      ) {
        return json(
          {
            error: "turn_deadline_expired",
          },
          409,
        );
      }

      const command =
        parseCommand(body.command);

      if (!command) {
        return json(
          {
            error: "invalid_command",
          },
          400,
        );
      }

      nextState =
        applyAuthoritativeOkeyMatchCommand(
          state,
          playerIndex,
          command,
          commandReceivedAtMs,
        );

      commandType = command.type;
      acceptedCommand = command;
    }
  } catch (error) {
    if (error instanceof OkeyCommandError) {
      return json(
        {
          error: error.code,
        },
        409,
      );
    }

    console.error(
      "Okey engine failure",
      error,
    );

    return json(
      {
        error: "engine_failure",
      },
      500,
    );
  }

  const nextVersion =
    Number(bundle.version) + 1;

  const deadline = getOkeyMatchTurnDeadlineAfterTransition(
    state,
    nextState,
    bundle.turn_deadline_at,
  );

  switch (acceptedCommand.type) {
    case "manual-leave":
      actionEventDrafts = [{ type: "leave", actorPlayerId: state.roundState.players[playerIndex]?.id ?? null, payload: {} }];
      break;
    case "start-next-round":
      actionEventDrafts = [{ type: "round", actorPlayerId: null, payload: { round: nextState.currentRound } }];
      break;
    case "system-timeout": {
      const event = nextState.lastTimeoutDiscardEvent;
      const tile = nextState.roundState.discardPile[nextState.roundState.discardPile.length - 1] ?? null;
      const actorPlayerId = event?.playerId ?? actingPlayer?.id ?? "";
      actionEventDrafts = event?.source === "rack"
        ? [{ type: "discard", actorPlayerId, payload: { tileId: tile?.id ?? null, tile, reason: "timeout" } }]
        : createForcedDrawDiscardEvents({
            actorPlayerId,
            source: "deck",
            tile,
            reason: "timeout",
          });
      break;
    }
    case "system-eliminated-turn": {
      const tile = nextState.roundState.discardPile[nextState.roundState.discardPile.length - 1] ?? null;
      actionEventDrafts = createForcedDrawDiscardEvents({
        actorPlayerId: actingPlayer?.id ?? "",
        source: "deck",
        tile,
        reason: "eliminated",
      });
      break;
    }
    default:
      actionEventDrafts = createOkeyCommandActionEvents(
        acceptedCommand,
        actingPlayer?.id ?? "",
        state.roundState,
      );
  }
  const previousTopDiscard = state.roundState.discardPile[state.roundState.discardPile.length - 1] ?? null;
  actionEventDrafts = actionEventDrafts.map((event) =>
    event.type === "draw" && event.payload.source === "discard" && previousTopDiscard
      ? { ...event, payload: { ...event.payload, tile: previousTopDiscard } }
      : event
  );
  const committedTopDiscard = nextState.roundState.discardPile[nextState.roundState.discardPile.length - 1] ?? null;
  actionEventDrafts = actionEventDrafts.map((event) =>
    event.type === "discard" && committedTopDiscard
      ? { ...event, payload: { ...event.payload, tileId: committedTopDiscard.id, tile: committedTopDiscard } }
      : event
  );

  const publicProjection =
    projectOkeyMatchPublicState(
      nextState,
      nextVersion,
      deadline,
    );
  const dailyQuestEvents = isTestMatch
    ? []
    : deriveOkeyDailyQuestGameplayEvents(
      state,
      nextState,
      playerIndex,
      acceptedCommand,
      body.commandId as string,
    );

const {
  data: commitRaw,
  error: commitError,
} = await service
  .rpc(
    "okey_commit_authoritative_action_with_events",
    {
      p_match_id: matchId,
      p_user_id: authData.user.id,
      p_command_id: body.commandId,
      p_expected_version:
        action === "manual-leave"
          ? Number(bundle.version)
          : (clientExpectedVersion ?? Number(bundle.version)),
      p_command_type: commandType,
      p_state: nextState,
      p_projection: publicProjection,
      p_status:
        nextState.matchFinished
          ? "finished"
          : "playing",
      p_turn_deadline_at: deadline,
      p_gameplay_events: dailyQuestEvents,
      p_action_events: actionEventDrafts,
    },
  )
  .single();

const commit =
  commitRaw as OkeyAuthoritativeCommit | null;

  if (commitError || !commit) {
    const conflict =
      commitError?.message.includes(
        "version_conflict",
      ) ?? false;

    return json(
      {
        error: conflict
          ? action === "resolve-timeout" || action === "play-eliminated" || action === "start-next-round"
            ? "already_processed"
            : "version_conflict"
          : "commit_failed",
        code: conflict && (action === "resolve-timeout" || action === "play-eliminated" || action === "start-next-round")
          ? "already_processed"
          : undefined,
        details: commitError?.message,
      },
      conflict ? 409 : 500,
    );
  }

  const committedState =
    commit.state as OkeyAuthoritativeMatchState;
  const committedActionEvents = commit.action_events ?? [];
  const committedProjection = projectForViewer(
    committedState,
    commit.version,
    commit.turn_deadline_at,
  );

  /*
   * The game-state broadcast must not be blocked by a later settlement
   * failure. Clients must still learn that the authoritative match
   * reached its committed state.
   */
  try {
    await broadcastStateUpdate(
      commit.version,
      committedActionEvents,
    );
  } catch (broadcastError) {
    console.error(
      "Okey match broadcast failed",
      broadcastError,
    );
  }

  if (!committedState.matchFinished) {
    try {
      if (!workerSecret) {
        throw new Error("okey_worker_secret_not_configured");
      }
      await handOffOkeyBotTurn({
        supabaseUrl,
        workerSecret,
        matchId,
        state: committedState,
        version: Number(commit.version),
      });
    } catch (handoffError) {
      console.error(`Okey Bot handoff failed for ${matchId}`, handoffError);
    }
  }

  if (committedState.matchFinished) {
    const result =
      await settleFinishedState(
        committedState,
      );

    if (result.error) {
      console.error(
        "Okey settlement failure",
        result.error,
      );

      return json(
        {
          error: "settlement_failed",
          details: result.error.message,
          committed: true,
          version: commit.version,
          projection: committedProjection,
        },
        500,
      );
    }

    return json({
      applied: commit.applied,
      actionEvents: committedActionEvents,
      settlement: result.settlement,
      projection: committedProjection,
    });
  }

  return json({
    applied: commit.applied,
    actionEvents: committedActionEvents,
    projection: committedProjection,
  });
});

