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

import type {
  OkeyGameState,
  OkeyMeld,
} from "../../../okey/types/okey.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
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
      return {
        type: "declare-konkan",
      };

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

    case "spend-meld":
    case "lock-konkan":
      return typeof command.tileId === "string" &&
          typeof command.targetPlayerId === "string" &&
          typeof command.targetMeldId === "string"
        ? {
            type: command.type,
            tileId: command.tileId,
            targetPlayerId: command.targetPlayerId,
            targetMeldId: command.targetMeldId,
          }
        : null;

    default:
      return null;
  }
}

function getWinnerTeamId(
  state: OkeyGameState,
): string | null {
  if (
    state.phase !== "finished" ||
    !state.winnerId
  ) {
    return null;
  }

  const winner = state.players.find(
    (player) => player.id === state.winnerId,
  );

  return winner?.teamId ?? null;
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
    action !== "resolve-timeout"
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
    (
      !isUuid(body.commandId) ||
      typeof body.expectedVersion !== "number" ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 0
    )
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

  const broadcastInvalidation = async (
    version: number,
    status: "playing" | "finished",
  ) => {
    const channel = service.channel(
      `okey-match:${matchId}`,
    );

    await channel.send({
      type: "broadcast",
      event: "invalidate",
      payload: {
        matchId,
        version,
        status,
      },
    });

    await service.removeChannel(channel);
  };

  const settleFinishedState = async (
    state: OkeyGameState,
  ) => {
    if (state.phase !== "finished") {
      return {
        settlement: null,
        error: null,
      };
    }

    if (!state.winnerId) {
      return {
        settlement: null,
        error: new Error(
          "finished_match_missing_winner",
        ),
      };
    }

    const winnerTeamId =
      getWinnerTeamId(state);

    if (!winnerTeamId) {
      return {
        settlement: null,
        error: new Error(
          "winner_team_not_found",
        ),
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

    return {
      settlement,
      error: null,
    };
  };

  const {
    data: bundle,
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

  if (bundleError || !bundle) {
    return json(
      {
        error: "match_not_found_or_forbidden",
      },
      404,
    );
  }

  const state =
    bundle.state as OkeyGameState;

  const playerIndex =
    bundle.player_index as number;

  /*
   * Snapshot normally only returns state.
   *
   * If a previous finished-state commit succeeded but settlement
   * temporarily failed, snapshot safely retries the idempotent
   * settlement.
   */
  if (isSnapshot) {
    let settlement: unknown = null;

    if (state.phase === "finished") {
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
      projection: projectOkeyState(
        state,
        playerIndex,
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

    if (state.phase === "finished") {
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
            projection: projectOkeyState(
              state,
              playerIndex,
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
      projection: projectOkeyState(
        state,
        playerIndex,
        bundle.version,
        bundle.turn_deadline_at,
      ),
    });
  }

  let nextState: OkeyGameState;
  let commandType: string;

  try {
    if (action === "resolve-timeout") {
      nextState =
        resolveAuthoritativeDeadline(
          state,
          bundle.turn_deadline_at,
        );

      commandType = "system-timeout";
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
        applyAuthoritativeOkeyCommand(
          state,
          playerIndex,
          command,
        );

      commandType = command.type;
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

  const deadline =
    nextState.phase === "finished"
      ? null
      : getNextOkeyTurnDeadline(nextState);

  const publicProjection =
    projectOkeyPublicState(
      nextState,
      nextVersion,
      deadline,
    );

  const {
    data: commit,
    error: commitError,
  } = await service
    .rpc(
      "okey_commit_authoritative_command",
      {
        p_match_id: matchId,
        p_user_id: authData.user.id,
        p_command_id: body.commandId,
        p_expected_version:
          body.expectedVersion,
        p_command_type: commandType,
        p_state: nextState,
        p_projection: publicProjection,
        p_status:
          nextState.phase === "finished"
            ? "finished"
            : "playing",
        p_turn_deadline_at: deadline,
      },
    )
    .single();

  if (commitError || !commit) {
    const conflict =
      commitError?.message.includes(
        "version_conflict",
      ) ?? false;

    return json(
      {
        error: conflict
          ? "version_conflict"
          : "commit_failed",
        details: commitError?.message,
      },
      conflict ? 409 : 500,
    );
  }

  const committedState =
    commit.state as OkeyGameState;

  const committedStatus =
    committedState.phase === "finished"
      ? "finished"
      : "playing";

  /*
   * The game-state broadcast must not be blocked by a later settlement
   * failure. Clients must still learn that the authoritative match
   * reached its committed state.
   */
  try {
    await broadcastInvalidation(
      commit.version,
      committedStatus,
    );
  } catch (broadcastError) {
    console.error(
      "Okey match broadcast failed",
      broadcastError,
    );
  }

  if (committedState.phase === "finished") {
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
          projection: projectOkeyState(
            committedState,
            playerIndex,
            commit.version,
            commit.turn_deadline_at,
          ),
        },
        500,
      );
    }

    return json({
      applied: commit.applied,
      settlement: result.settlement,
      projection: projectOkeyState(
        committedState,
        playerIndex,
        commit.version,
        commit.turn_deadline_at,
      ),
    });
  }

  return json({
    applied: commit.applied,
    projection: projectOkeyState(
      committedState,
      playerIndex,
      commit.version,
      commit.turn_deadline_at,
    ),
  });
});