
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import type {
  OkeyAuthoritativeMatchState,
  OkeyMatchServerProjection,
} from "../../../okey/server/okey-authoritative.ts";
import type { OkeyActionEvent } from "../../../okey/server/okey-action-events.ts";
import { deterministicCommandId } from "../_shared/deterministic-command-id.ts";

const MATCH_LIMIT = 100;

type MatchRow = {
  id: string;
  version: number | string;
  status: "finished";
  settlement_at: string | null;
  public_projection: OkeyMatchServerProjection;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const lifecycleSecret = Deno.env.get("AZNIF_LIFECYCLE_SECRET");
  const receivedLifecycleSecret = request.headers.get("x-aznif-lifecycle-key");


  if (
    !supabaseUrl ||
    !serviceKey ||
    !lifecycleSecret ||
    receivedLifecycleSecret !== lifecycleSecret
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const broadcast = async (
    matchId: string,
    commandId: string,
    version: number,
    publicProjection: OkeyMatchServerProjection,
    actionEvents: OkeyActionEvent[] = [],
  ) => {
    const channel = service.channel(`okey-match:${matchId}`);

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

  const { data: settlementMatches, error: matchesError } = await service
    .schema("okey")
    .from("matches")
    .select("id, version, status, settlement_at, public_projection")
    .eq("status", "finished")
    .is("settlement_at", null)
    .order("updated_at", { ascending: true })
    .limit(MATCH_LIMIT);

  if (matchesError) {
    console.error("Okey maintenance settlement query failed", matchesError);
    return json({
      error: "match_query_failed",
      details: matchesError.message,
    }, 500);
  }

  let recoveredSettlements = 0;
  let skipped = 0;
  let failed = 0;
  const failures: Array<{ matchId: string; error: string }> = [];

  for (const match of (settlementMatches ?? []) as MatchRow[]) {
    try {
      const { data: stateRow, error: stateError } = await service
        .schema("okey")
        .from("match_private_states")
        .select("state")
        .eq("match_id", match.id)
        .single();

      if (stateError || !stateRow) {
        skipped += 1;
        continue;
      }

      const state = stateRow.state as OkeyAuthoritativeMatchState;
      if (!state.matchFinished) {
        skipped += 1;
        continue;
      }

      const winnerTeamId = state.matchWinnerTeamId;
      if (!winnerTeamId && state.leaveTerminationReason !== "no-humans") {
        throw new Error("finished_match_missing_winner_team");
      }

      const { error: settlementError } = await service.rpc("okey_settle_match", {
        p_match_id: match.id,
        p_winner_team_id: winnerTeamId,
      });

      if (settlementError) {
        throw new Error(`settlement_recovery_failed: ${settlementError.message}`);
      }

      recoveredSettlements += 1;

      try {
        await broadcast(
          match.id,
          await deterministicCommandId(
            `okey:${match.id}:maintenance-settlement:${match.version}`,
          ),
          Number(match.version),
          match.public_projection,
        );
      } catch (broadcastError) {
        console.error(`Okey settlement recovery broadcast failed for ${match.id}`, broadcastError);
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "unknown_maintenance_error";
      console.error(`Okey maintenance settlement recovery failed for match ${match.id}`, error);
      failures.push({ matchId: match.id, error: message });
    }
  }

  return json({
    scanned: settlementMatches?.length ?? 0,
    recoveredSettlements,
    skipped,
    failed,
    failures,
  });
});

