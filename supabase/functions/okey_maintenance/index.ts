import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  getNextOkeyMatchTurnDeadline,
  projectOkeyMatchPublicState,
  resolveAuthoritativeMatchDeadline,
  settleAuthoritativeOkeyRound,
  type OkeyAuthoritativeMatchState,
} from "../../../okey/server/okey-authoritative.ts";

import { playBotTurn } from "../../../okey/engine/okey-bot-engine.ts";


const MATCH_LIMIT = 100;

type MatchRow = {
  id: string;
  version: number | string;
  status: "playing" | "finished";
  turn_deadline_at: string | null;
  settlement_at: string | null;
};

type SeatRow = {
  user_id: string;
  player_index: number;
  connected: boolean;
  last_seen_at: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createCommandId() {
  return crypto.randomUUID();
}

function isExpired(
  timestamp: string | null | undefined,
  now: number,
) {
  if (!timestamp) {
    return false;
  }

  const parsed = Date.parse(timestamp);

  return Number.isFinite(parsed) && parsed <= now;
}

function getWinnerTeamId(
  state: OkeyAuthoritativeMatchState,
): "teamA" | "teamB" | null {
  if (!state.matchFinished) {
    return null;
  }

  return state.matchWinnerTeamId;
}

serve(async (request) => {
  if (request.method !== "POST") {
    return json(
      {
        error: "method_not_allowed",
      },
      405,
    );
  }

  const supabaseUrl =
    Deno.env.get("SUPABASE_URL");

  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const workerSecret =
    Deno.env.get("OKEY_WORKER_SECRET");

  const receivedWorkerSecret =
    request.headers.get("x-okey-worker-key");

  if (
    !supabaseUrl ||
    !serviceKey ||
    !workerSecret ||
    receivedWorkerSecret !== workerSecret
  ) {
    return json(
      {
        error: "unauthorized",
      },
      401,
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

  /*
   * دو نوع مسابقه بررسی می‌شود:
   *
   * 1. playing:
   *    timeout، قطع اتصال و حرکت Bot
   *
   * 2. finished و settlement_at = null:
   *    بازی تمام شده ولی پرداخت جایزه قبلاً شکست خورده است
   */
  const {
    data: matches,
    error: matchesError,
  } = await service
    .schema("okey")
    .from("matches")
    .select(
      "id, version, status, turn_deadline_at, settlement_at",
    )
    .or(
      "status.eq.playing,and(status.eq.finished,settlement_at.is.null)",
    )
    .order("updated_at", {
      ascending: true,
    })
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

  let processed = 0;
  let settled = 0;
  let recoveredSettlements = 0;
  let skipped = 0;
  let failed = 0;

  const failures: Array<{
    matchId: string;
    error: string;
  }> = [];

  for (
    const rawMatch of (matches ?? []) as MatchRow[]
  ) {
    const match = rawMatch;

    try {
      const [
        {
          data: stateRow,
          error: stateError,
        },
        {
          data: rawSeats,
          error: seatsError,
        },
      ] = await Promise.all([
        service
          .schema("okey")
          .from("match_private_states")
          .select("state")
          .eq("match_id", match.id)
          .single(),

        service
          .schema("okey")
          .from("match_seats")
          .select(
            "user_id, player_index, connected, last_seen_at",
          )
          .eq("match_id", match.id),
      ]);

      const seats =
        (rawSeats ?? []) as SeatRow[];

      if (
        stateError ||
        seatsError ||
        !stateRow ||
        seats.length !== 4
      ) {
        skipped += 1;
        continue;
      }

      const originalState =
        stateRow.state as OkeyAuthoritativeMatchState;

      /*
       * بازی از قبل finished شده، ولی settlement قبلی
       * موفق نبوده است. فقط settlement را دوباره اجرا می‌کنیم.
       */
      if (match.status === "finished") {
        const winnerTeamId =
          getWinnerTeamId(originalState);

        if (!winnerTeamId) {
          throw new Error(
            "finished_match_missing_winner_team",
          );
        }

        const {
          error: settlementError,
        } = await service.rpc(
          "okey_settle_match",
          {
            p_match_id: match.id,
            p_winner_team_id: winnerTeamId,
          },
        );

        if (settlementError) {
          throw new Error(
            `settlement_recovery_failed: ${settlementError.message}`,
          );
        }

        settled += 1;
        recoveredSettlements += 1;

        try {
          const channel = service.channel(
            `okey-match:${match.id}`,
          );

          await channel.send({
            type: "broadcast",
            event: "invalidate",
            payload: {
              matchId: match.id,
              version: Number(match.version),
              status: "finished",
            },
          });

          await service.removeChannel(channel);
        } catch (broadcastError) {
          console.error(
            `Okey recovery broadcast failed for ${match.id}`,
            broadcastError,
          );
        }

        continue;
      }

      let nextState = originalState;
      let changed = false;

      const now = Date.now();

      /*
       * timeout authoritative
       */
      if (
        isExpired(
          match.turn_deadline_at,
          now,
        )
      ) {
        nextState =
          resolveAuthoritativeMatchDeadline(
            nextState,
            match.turn_deadline_at,
          );

        changed = true;
      }

      /*
       * در هر اجرای worker فقط یک حرکت Bot انجام می‌شود.
       */
      const currentPlayer =
        nextState.roundState.players[
          nextState.roundState.currentPlayerIndex
        ];

      if (
        !nextState.matchFinished &&
        currentPlayer?.controlledByBot
      ) {
        nextState = settleAuthoritativeOkeyRound({
          ...nextState,
          roundState: playBotTurn(
            nextState.roundState,
            {
              difficulty:
                currentPlayer.botDifficulty ??
                "normal",
            },
          ),
        });

        changed = true;
      }

      if (!changed) {
        skipped += 1;
        continue;
      }

      const actorSeat =
        seats.find(
          (seat) =>
            seat.player_index ===
            originalState.roundState.currentPlayerIndex,
        ) ?? seats[0];

      if (!actorSeat?.user_id) {
        skipped += 1;
        continue;
      }

      const expectedVersion =
        Number(match.version);

      if (
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0
      ) {
        skipped += 1;
        continue;
      }

      const nextVersion =
        expectedVersion + 1;

      const deadline =
        getNextOkeyMatchTurnDeadline(
          nextState,
        );

      const {
        data: commit,
        error: commitError,
      } = await service
        .rpc(
          "okey_commit_authoritative_command",
          {
            p_match_id: match.id,
            p_user_id: actorSeat.user_id,
            p_command_id:
              createCommandId(),
            p_expected_version:
              expectedVersion,
            p_command_type:
              "system-maintenance",
            p_state: nextState,
            p_projection:
              projectOkeyMatchPublicState(
                nextState,
                nextVersion,
                deadline,
              ),
            p_status:
              nextState.matchFinished
                ? "finished"
                : "playing",
            p_turn_deadline_at:
              deadline,
          },
        )
        .single();

      if (commitError || !commit) {
        const versionConflict =
          commitError?.message.includes(
            "version_conflict",
          ) ?? false;

        /*
         * conflict طبیعی است؛ کلاینت یا worker دیگری
         * زودتر state را تغییر داده است.
         */
        if (versionConflict) {
          skipped += 1;
          continue;
        }

        throw new Error(
          commitError?.message ??
            "maintenance_commit_failed",
        );
      }

      processed += 1;

      /*
       * ابتدا state جدید را broadcast می‌کنیم.
       * شکست settlement نباید مانع دیده‌شدن state نهایی شود.
       */
      try {
        const channel = service.channel(
          `okey-match:${match.id}`,
        );

        await channel.send({
          type: "broadcast",
          event: "invalidate",
          payload: {
            matchId: match.id,
            version: Number((commit as { version: number }).version),
            status:
              nextState.matchFinished
                ? "finished"
                : "playing",
          },
        });

        await service.removeChannel(channel);
      } catch (broadcastError) {
        console.error(
          `Okey maintenance broadcast failed for ${match.id}`,
          broadcastError,
        );
      }

      /*
       * اگر حرکت Bot یا timeout بازی را تمام کرد،
       * Prize Pool میان دو عضو تیم برنده تقسیم می‌شود.
       */
      if (nextState.matchFinished) {
        const winnerTeamId =
          getWinnerTeamId(nextState);

        if (!winnerTeamId) {
          throw new Error(
            "finished_match_missing_winner_team",
          );
        }

        const {
          error: settlementError,
        } = await service.rpc(
          "okey_settle_match",
          {
            p_match_id: match.id,
            p_winner_team_id:
              winnerTeamId,
          },
        );

        if (settlementError) {
          /*
           * بازی در دیتابیس finished شده است.
           * اجرای بعدی worker به‌خاطر settlement_at=null
           * دوباره settlement را امتحان می‌کند.
           */
          throw new Error(
            `settlement_failed: ${settlementError.message}`,
          );
        }

        settled += 1;
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

  return json({
    scanned: matches?.length ?? 0,
    processed,
    settled,
    recoveredSettlements,
    skipped,
    failed,
    failures,
  });
});