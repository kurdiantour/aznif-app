import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  applyAuthoritativeOkeyMatchCommand,
  applyAuthoritativeManualLeave,
  deriveOkeyDailyQuestGameplayEvents,
  getOkeyMatchTurnDeadlineAfterTransition,
  OkeyCommandError,
  projectOkeyMatchPublicState,
  projectOkeyMatchState,
  type OkeyAuthoritativeCommand,
  type OkeyAuthoritativeMatchState,
  type OkeyMatchServerProjection,
} from "../../../okey/server/okey-authoritative.ts";

import type {
  OkeyMeld,
} from "../../../okey/types/okey.ts";
import {
  createOkeyCommandActionEvents,
  type OkeyActionEvent,
  type OkeyActionEventDraft,
} from "../../../okey/server/okey-action-events.ts";
import {
  reconcileAuthoritativeServerTurns,
} from "../../../okey/server/okey-server-reconciler.ts";
import { isOkeyBotControlled } from "../../../okey/engine/okey-bot-policy.ts";
import { deterministicCommandId } from "../_shared/deterministic-command-id.ts";
import { handOffOkeyServerLifecycle } from "../_shared/okey-bot-handoff.ts";
// Authoritative bot turns are handled directly by reconciler and timeout wakeup
import { executeAuthoritativeOkeyTurn } from "../../../lib/multiplayer/okey/okey-turn-engine.ts";

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
   * Snapshot normally only returns state.
   *
   * If a previous finished-state commit succeeded but settlement
   * temporarily failed, snapshot safely retries the idempotent
   * settlement.
   */
  if (isSnapshot) {
    let currentState = state;
    let currentVersion = Number(bundle.version);
    let currentDeadline = bundle.turn_deadline_at;

    if (!currentState.matchFinished && currentState.roundState.phase === "playing") {
      const serverReconcile = await reconcileAuthoritativeServerTurns({
        client: service,
        matchId,
        requesterUserId: authData.user.id,
        state: currentState,
        version: currentVersion,
        turnDeadlineAt: currentDeadline,
        deterministicCommandId,
        broadcastStateUpdate: async (payload) => {
          await broadcastStateUpdate(
            payload.commandId,
            payload.version,
            payload.publicProjection,
            payload.actionEvents,
          );
        },
      });
      currentState = serverReconcile.state;
      currentVersion = serverReconcile.version;
      currentDeadline = serverReconcile.turnDeadlineAt;
    }

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

    if (currentState.matchFinished) {
      const result =
        await settleFinishedState(currentState);

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
        currentState,
        currentVersion,
        currentDeadline,
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
        console.error(
          "Okey settlement recovery failed during duplicate",
          result.error,
        );
      } else {
        settlement = result.settlement;
      }
    }

    return json({
      applied: true,
      settlement,
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
    action === "command" &&
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
  let commit: OkeyAuthoritativeCommit | null = null;
  let workingBundle = bundle;
  const maxCommitAttempts = action === "manual-leave" ? 3 : 1;

  for (let commitAttempt = 1; commitAttempt <= maxCommitAttempts; commitAttempt += 1) {
    if (commitAttempt > 1) {
      // Rebuild from trusted service-role reads. This remains available even
      // if the conflicting transition already released the membership to a Bot.
      const freshBundle = await loadManualLeaveBundle();
      if (!freshBundle) {
        return json({ error: "manual_leave_retry_fetch_failed" }, 409);
      }
      workingBundle = freshBundle;

      if (workingBundle.command_applied) {
        commit = {
          applied: true,
          version: Number(workingBundle.version),
          state: workingBundle.state as OkeyAuthoritativeMatchState,
          turn_deadline_at: workingBundle.turn_deadline_at,
          action_events: [],
        };
        break;
      }

      const alreadyLeft = ((workingBundle.state as OkeyAuthoritativeMatchState).manualLeftPlayerIds ?? [])
        .includes(authData.user.id);
      if (alreadyLeft) {
        commit = {
          applied: true,
          version: Number(workingBundle.version),
          state: workingBundle.state as OkeyAuthoritativeMatchState,
          turn_deadline_at: workingBundle.turn_deadline_at,
          action_events: [],
        };
        break;
      }
    }

    const workingState = workingBundle.state as OkeyAuthoritativeMatchState;
    const workingPlayerIndex = Number(workingBundle.player_index);
    const actingPlayer =
      workingState.roundState.players[workingState.roundState.currentPlayerIndex] ?? null;

    let nextState: OkeyAuthoritativeMatchState;
    let commandType: string;
    let acceptedCommand: OkeyAuthoritativeCommand | { type: "manual-leave" };
    let actionEventDrafts: OkeyActionEventDraft[] = [];

    try {
      if (action === "manual-leave") {
        nextState = applyAuthoritativeManualLeave(
          workingState,
          workingPlayerIndex,
        );
        commandType = "manual-leave";
        acceptedCommand = { type: "manual-leave" };
      } else {
        if (
          workingBundle.turn_deadline_at &&
          Date.parse(workingBundle.turn_deadline_at) <= Date.now()
        ) {
          return json({ error: "turn_deadline_expired" }, 409);
        }

        const command = parseCommand(body.command);
        if (!command) {
          return json({ error: "invalid_command" }, 400);
        }

        nextState = applyAuthoritativeOkeyMatchCommand(
          workingState,
          workingPlayerIndex,
          command,
          commandReceivedAtMs,
        );
        commandType = command.type;
        acceptedCommand = command;
      }
    } catch (error) {
      if (error instanceof OkeyCommandError) {
        return json({ error: error.code }, 409);
      }
      console.error("Okey engine failure", error);
      return json({ error: "engine_failure" }, 500);
    }

    const expectedVersion = action === "manual-leave"
      ? Number(workingBundle.version)
      : (clientExpectedVersion ?? Number(workingBundle.version));
    const nextVersion = expectedVersion + 1;
    const deadline = getOkeyMatchTurnDeadlineAfterTransition(
      workingState,
      nextState,
      workingBundle.turn_deadline_at,
    );

    if (acceptedCommand.type === "manual-leave") {
      actionEventDrafts = [{
        type: "leave",
        actorPlayerId: workingState.roundState.players[workingPlayerIndex]?.id ?? null,
        payload: {},
      }];
    } else {
      actionEventDrafts = createOkeyCommandActionEvents(
        acceptedCommand,
        actingPlayer?.id ?? "",
        workingState.roundState,
      );
    }

    const previousTopDiscard =
      workingState.roundState.discardPile[workingState.roundState.discardPile.length - 1] ?? null;
    actionEventDrafts = actionEventDrafts.map((event) =>
      event.type === "draw" && event.payload.source === "discard" && previousTopDiscard
        ? { ...event, payload: { ...event.payload, tile: previousTopDiscard } }
        : event
    );

    const committedTopDiscard =
      nextState.roundState.discardPile[nextState.roundState.discardPile.length - 1] ?? null;
    actionEventDrafts = actionEventDrafts.map((event) =>
      event.type === "discard" && committedTopDiscard
        ? {
            ...event,
            payload: {
              ...event.payload,
              tileId: committedTopDiscard.id,
              tile: committedTopDiscard,
            },
          }
        : event
    );

    const publicProjection = projectOkeyMatchPublicState(
      nextState,
      nextVersion,
      deadline,
    );
    const dailyQuestEvents = isTestMatch
      ? []
      : deriveOkeyDailyQuestGameplayEvents(
          workingState,
          nextState,
          workingPlayerIndex,
          acceptedCommand,
          body.commandId as string,
        );

    try {
      const turnResult = await executeAuthoritativeOkeyTurn({
        controller: action === "manual-leave" ? "manual-leave" : "human",
        matchId,
        actorPlayerId: authData.user.id,
        commandId: body.commandId as string,
        commandType,
        expectedVersion,
        intent: acceptedCommand,
        validate: () => ({
          state: nextState,
          projection: publicProjection,
          deadline,
          status: nextState.matchFinished ? "finished" as const : "playing" as const,
          actionEvents: actionEventDrafts,
        }),
        commit: async (prepared) => {
          const { data, error } = await service.rpc(
            "okey_commit_authoritative_action_with_events",
            {
              p_match_id: matchId,
              p_user_id: authData.user.id,
              p_command_id: body.commandId,
              p_expected_version: expectedVersion,
              p_command_type: commandType,
              p_state: prepared.state,
              p_projection: prepared.projection,
              p_status: prepared.status,
              p_turn_deadline_at: prepared.deadline,
              p_gameplay_events: dailyQuestEvents,
              p_action_events: prepared.actionEvents,
            },
          ).single();
          if (error || !data) throw new Error(error?.message ?? "commit_failed");
          return data as OkeyAuthoritativeCommit;
        },
        advance: async (committed) => committed,
        broadcast: async (committed) => {
          try {
            await broadcastStateUpdate(
              committed.commandId,
              committed.version,
              projectOkeyMatchPublicState(
                committed.state,
                committed.version,
                committed.turnDeadlineAt,
              ),
              committed.actionEvents,
            );
          } catch (broadcastError) {
            console.error("Okey match broadcast failed", broadcastError);
          }
        },
      });

      commit = {
        ...turnResult.committed,
        applied: turnResult.committed.applied ?? false,
      };
      break;
    } catch (commitError) {
      const details = commitError instanceof Error ? commitError.message : String(commitError);
      const conflict = details.includes("version_conflict");

      if (action === "manual-leave" && conflict && commitAttempt < maxCommitAttempts) {
        continue;
      }

      return json(
        { error: conflict ? "version_conflict" : "commit_failed", details },
        conflict ? 409 : 500,
      );
    }
  }

  if (!commit) {
    return json({ error: "manual_leave_retry_exhausted" }, 409);
  }

  const committedState =
    commit.state as OkeyAuthoritativeMatchState;
  const committedActionEvents = commit.action_events ?? [];
  const committedProjection = projectForViewer(
    committedState,
    commit.version,
    commit.turn_deadline_at,
  );
  const serverReconcile = await reconcileAuthoritativeServerTurns({
    client: service,
    matchId,
    requesterUserId: authData.user.id,
    state: committedState,
    version: commit.version,
    turnDeadlineAt: commit.turn_deadline_at,
    deterministicCommandId,
    broadcastStateUpdate: async (payload) => {
      await broadcastStateUpdate(
        payload.commandId,
        payload.version,
        payload.publicProjection,
        payload.actionEvents,
      );
    },
  });

  const finalState = serverReconcile.state;
  const finalVersion = serverReconcile.version;
  const finalDeadline = serverReconcile.turnDeadlineAt;
  const finalActionEvents = [
    ...committedActionEvents,
    ...serverReconcile.actionEvents,
  ];

  const finalProjection = projectForViewer(
    finalState,
    finalVersion,
    finalDeadline,
  );

  // Server-owned lifecycle handoff. A fresh worker invocation owns the next
  // Bot / Human timeout / Takeover / Next-Round transition.
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (!finalState.matchFinished && workerSecret) {
    const lifecycleHandoff = handOffOkeyServerLifecycle({
      supabaseUrl,
      workerSecret,
      matchId,
      expectedVersion: finalVersion,
      eligibleAt: finalState.roundState.phase === "finished"
        ? finalState.nextRoundEligibleAt
        : null,
      turnDeadlineAt: finalDeadline,
    }).catch((handoffError) => {
      console.error("Okey server lifecycle handoff failed for match", matchId, handoffError);
    });

    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(lifecycleHandoff);
    } else {
      await lifecycleHandoff;
    }
  }

  if (finalState.matchFinished) {
    const result =
      await settleFinishedState(
        finalState,
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
          version: finalVersion,
          projection: finalProjection,
        },
        500,
      );
    }

    return json({
      applied: commit.applied,
      actionEvents: finalActionEvents,
      settlement: result.settlement,
      projection: finalProjection,
    });
  }

  return json({
    applied: commit.applied,
    actionEvents: finalActionEvents,
    projection: finalProjection,
  });
});



