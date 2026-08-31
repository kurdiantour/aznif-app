import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  getNextOkeyMatchTurnDeadline,
  projectOkeyMatchPublicState,
  startAuthoritativeOkeyNextRound,
  type OkeyAuthoritativeMatchState,
} from "../../../okey/server/okey-authoritative.ts";
import type { OkeyActionEvent } from "../../../okey/server/okey-action-events.ts";
import { deterministicCommandId } from "../_shared/deterministic-command-id.ts";
import { handOffOkeyBotTurn } from "../_shared/okey-bot-handoff.ts";

const MATCH_LIMIT = 100;

type MatchRow = {
  id: string;
  version: number | string;
  status: "finished";
  settlement_at: string | null;
  is_test: boolean;
};

type RecoverableRoundRow = {
  id: string;
  version: number | string;
  status: "playing";
  next_round_eligible_at: string;
};

type PlayingMatchRow = {
  id: string;
  version: number | string;
  status: "playing";
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
  const workerSecret = Deno.env.get("OKEY_WORKER_SECRET");
  const receivedWorkerSecret = request.headers.get("x-okey-worker-key");

  if (
    !supabaseUrl ||
    !serviceKey ||
    !workerSecret ||
    receivedWorkerSecret !== workerSecret
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const broadcast = async (
    matchId: string,
    version: number,
    actionEvents: OkeyActionEvent[] = [],
  ) => {
    const channel = service.channel(`okey-match:${matchId}`);

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

  const { data: settlementMatches, error: matchesError } = await service
    .schema("okey")
    .from("matches")
    .select("id, version, status, settlement_at, is_test")
    .eq("status", "finished")
    .is("settlement_at", null)
    .order("updated_at", { ascending: true })
    .limit(MATCH_LIMIT);

  if (matchesError) {
    console.error(
      "Okey maintenance match query failed",
      matchesError,
    );

    return json(
      {
        error: "match_query_failed",
        details: matchesError.message,
      },
      500,
    );
  }

  let recoveredSettlements = 0;
  let skipped = 0;
  let failed = 0;

  const failures: Array<{
    matchId: string;
    error: string;
  }> = [];

  for (const match of (settlementMatches ?? []) as MatchRow[]) {
    try {
      if (match.is_test) {
        const { error: testSettlementError } = await service
          .schema("okey")
          .from("matches")
          .update({
            settlement_at: new Date().toISOString(),
            settlement: { type: "test", economyApplied: false },
          })
          .eq("id", match.id)
          .eq("is_test", true)
          .is("settlement_at", null);
        if (testSettlementError) throw new Error(testSettlementError.message);
        recoveredSettlements += 1;
        try {
          await broadcast(match.id, Number(match.version));
        } catch (broadcastError) {
          console.error(
            `Okey test recovery broadcast failed for ${match.id}`,
            broadcastError,
          );
        }
        continue;
      }
      const { data: stateRow, error: stateError } =
        await service
          .schema("okey")
          .from("match_private_states")
          .select("state")
          .eq("match_id", match.id)
          .single();

      if (stateError || !stateRow) {
        skipped += 1;
        continue;
      }

      const state =
        stateRow.state as OkeyAuthoritativeMatchState;

      if (!state.matchFinished) {
        skipped += 1;
        continue;
      }

      const winnerTeamId = state.matchWinnerTeamId;

      if (
        !winnerTeamId &&
        state.leaveTerminationReason !== "no-humans"
      ) {
        throw new Error(
          "finished_match_missing_winner_team",
        );
      }

      const { error: settlementError } =
        await service.rpc("okey_settle_match", {
          p_match_id: match.id,
          p_winner_team_id: winnerTeamId,
        });

      if (settlementError) {
        throw new Error(
          `settlement_recovery_failed: ${settlementError.message}`,
        );
      }

      recoveredSettlements += 1;

      try {
        await broadcast(
          match.id,
          Number(match.version),
        );
      } catch (broadcastError) {
        console.error(
          `Okey recovery broadcast failed for ${match.id}`,
          broadcastError,
        );
      }
    } catch (error) {
      failed += 1;

      const message =
        error instanceof Error
          ? error.message
          : "unknown_maintenance_error";

      console.error(
        `Okey maintenance failed for match ${match.id}`,
        error,
      );

      failures.push({
        matchId: match.id,
        error: message,
      });
    }
  }

  const maintenanceNow = new Date().toISOString();
  const { data: recoverableRounds, error: recoveryQueryError } = await service
    .schema("okey")
    .from("matches")
    .select("id, version, status, next_round_eligible_at")
    .eq("status", "playing")
    .not("next_round_eligible_at", "is", null)
    .lte("next_round_eligible_at", maintenanceNow)
    .order("next_round_eligible_at", { ascending: true })
    .limit(MATCH_LIMIT);

  if (recoveryQueryError) {
    return json(
      {
        error: "next_round_recovery_query_failed",
        details: recoveryQueryError.message,
      },
      500,
    );
  }

  let recoveredRounds = 0;
  let recoveryConflicts = 0;

  for (const match of (recoverableRounds ?? []) as RecoverableRoundRow[]) {
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
      const eligibleAtMs = Date.parse(state.nextRoundEligibleAt ?? "");
      if (
        state.matchFinished ||
        state.roundState.phase !== "finished" ||
        !Number.isFinite(eligibleAtMs) ||
        eligibleAtMs > Date.now()
      ) {
        skipped += 1;
        continue;
      }

      const { data: claimantSeat, error: seatError } = await service
        .schema("okey")
        .from("match_seats")
        .select("user_id")
        .eq("match_id", match.id)
        .order("player_index", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (seatError || !claimantSeat?.user_id) {
        skipped += 1;
        continue;
      }

      const expectedVersion = Number(match.version);
      const nextState = startAuthoritativeOkeyNextRound(state);
      const nextVersion = expectedVersion + 1;
      const deadline = getNextOkeyMatchTurnDeadline(nextState);
      const { data: commit, error: commitError } = await service
        .rpc("okey_commit_authoritative_action", {
          p_match_id: match.id,
          p_user_id: claimantSeat.user_id,
          p_command_id: await deterministicCommandId(
            "okey:" + match.id +
              ":maintenance-next-round:" + expectedVersion +
              ":" + state.currentRound,
          ),
          p_expected_version: expectedVersion,
          p_command_type: "start-next-round",
          p_state: nextState,
          p_projection: projectOkeyMatchPublicState(
            nextState,
            nextVersion,
            deadline,
          ),
          p_status: "playing",
          p_turn_deadline_at: deadline,
          p_action_events: [{ type: "round", actorPlayerId: null, payload: { round: nextState.currentRound } }],
        })
        .single();

      if (commitError || !commit) {
        if (commitError?.message?.includes("version_conflict")) {
          recoveryConflicts += 1;
          continue;
        }
        throw new Error(commitError?.message ?? "next_round_recovery_commit_failed");
      }

      recoveredRounds += 1;
      try {
        await handOffOkeyBotTurn({
          supabaseUrl,
          workerSecret,
          matchId: match.id,
          state: nextState,
          version: Number((commit as { version: number }).version),
        });
      } catch (handoffError) {
        console.error(
          "Okey next-round Bot handoff failed for " + match.id,
          handoffError,
        );
      }
      try {
        await broadcast(
          match.id,
          Number((commit as { version: number }).version),
          (commit as { action_events?: OkeyActionEvent[] }).action_events ?? [],
        );
      } catch (broadcastError) {
        console.error(
          "Okey next-round recovery broadcast failed for " + match.id,
          broadcastError,
        );
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "unknown_recovery_error";
      failures.push({ matchId: match.id, error: message });
    }
  }

  const { data: playingMatches, error: botRecoveryQueryError } = await service
    .schema("okey")
    .from("matches")
    .select("id, version, status")
    .eq("status", "playing")
    .order("updated_at", { ascending: true })
    .limit(MATCH_LIMIT);

  if (botRecoveryQueryError) {
    return json(
      {
        error: "bot_recovery_query_failed",
        details: botRecoveryQueryError.message,
      },
      500,
    );
  }

  let botTurnsHandedOff = 0;

  for (const match of (playingMatches ?? []) as PlayingMatchRow[]) {
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

      const handedOff = await handOffOkeyBotTurn({
        supabaseUrl,
        workerSecret,
        matchId: match.id,
        state: stateRow.state as OkeyAuthoritativeMatchState,
        version: Number(match.version),
      });

      if (handedOff) botTurnsHandedOff += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "unknown_bot_handoff_error";
      failures.push({ matchId: match.id, error: message });
    }
  }

  return json({
    scanned: settlementMatches?.length ?? 0,
    recoveredSettlements,
    recoverableRoundsScanned: recoverableRounds?.length ?? 0,
    recoveredRounds,
    recoveryConflicts,
    playingMatchesScanned: playingMatches?.length ?? 0,
    botTurnsHandedOff,
    skipped,
    failed,
    failures,
  });
});

