import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
  projectOkeyMatchPublicState,
} from "../../../okey/server/okey-authoritative.ts";

type OkeyCurrency = "fun" | "aznif";

type TableEconomy = {
  entryFee: number;
  currency: OkeyCurrency;
  minPoints?: number;
};

type OkeyRoomMember = {
  userId: string;
  playerIndex: number;
  teamId: "teamA" | "teamB";
  displayName: string;
  avatarUrl: string | null;
  connected: boolean;
};

type OkeyRoomSnapshot = {
  matchId: string;
  roomCode: string;
  tableId: string;
  status: "waiting" | "playing" | "finished" | "cancelled";
  version: number;
  memberCount: number;
  connectedCount: number;
  confirmedCount: number;
  countdownEndsAt: string | null;
  shouldStart: boolean;
  members: OkeyRoomMember[];

  entryFee?: number;
  currency?: OkeyCurrency;
};

type ChargeResult = {
  charged?: boolean;
  reason?: string;
  entryFeePerPlayer?: number;
  commissionPerPlayer?: number;
  totalEntry?: number;
  totalCommission?: number;
  prizePool?: number;
};

const TABLE_ECONOMY: Record<string, TableEconomy> = {
  starter: {
    entryFee: 500,
    currency: "fun",
    minPoints: 0,
  },
  bronze: {
    entryFee: 3_500,
    currency: "fun",
    minPoints: 250,
  },
  silver: {
    entryFee: 15_000,
    currency: "fun",
    minPoints: 650,
  },
  gold: {
    entryFee: 25_000,
    currency: "fun",
    minPoints: 1_100,
  },
  "aznif-low": {
    entryFee: 10,
    currency: "aznif",
  },
  "aznif-mid": {
    entryFee: 25,
    currency: "aznif",
  },
  "aznif-high": {
    entryFee: 40,
    currency: "aznif",
  },
  "aznif-elite": {
    entryFee: 60,
    currency: "aznif",
  },
};


function withTableEconomy(room: OkeyRoomSnapshot): OkeyRoomSnapshot {
  const economy = TABLE_ECONOMY[room.tableId];
  if (!economy) throw new Error("room_has_unknown_table");
  return { ...room, entryFee: economy.entryFee, currency: economy.currency };
}
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");

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

  const authClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });

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
    ![
      "matchmake",
      "status",
      "heartbeat",
      "reconnect",
      "leave",
    ].includes(action)
  ) {
    return json(
      {
        error: "invalid_action",
      },
      400,
    );
  }

  if (
    action === "matchmake" &&
    (
      typeof body.tableId !== "string" ||
      body.tableId.trim().length === 0 ||
      body.tableId.length > 64
    )
  ) {
    return json(
      {
        error: "invalid_table",
      },
      400,
    );
  }

  if (
    action === "matchmake" &&
    !TABLE_ECONOMY[String(body.tableId)]
  ) {
    return json(
      {
        error: "unknown_table",
      },
      400,
    );
  }

  if (
    action !== "matchmake" &&
    !isUuid(body.matchId)
  ) {
    return json(
      {
        error: "invalid_match_id",
      },
      400,
    );
  }

  const metadata =
    authData.user.user_metadata ?? {};

const displayName = String(
  metadata.display_name ??
    metadata.full_name ??
    metadata.name ??
    authData.user.email?.split("@")[0] ??
    "Player"
).slice(0, 64);

  const avatarUrl =
    typeof metadata.avatar_url === "string"
      ? metadata.avatar_url
      : null;

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
   * Fun-table Point requirements are an admission rule, not a match reward.
   * Check them before joining the room so this cannot be bypassed by calling
   * the Edge Function directly instead of using the lobby UI.
   */
  if (action === "matchmake") {
    const economy = TABLE_ECONOMY[String(body.tableId)];

    if (economy?.currency === "fun") {
      const requiredPoints = economy.minPoints ?? 0;
      const { data: profile, error: profileError } = await service
        .from("profiles")
        .select("points")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (profileError) {
        return json({ error: "profile_lookup_failed" }, 500);
      }

      const playerPoints = Number(profile?.points ?? 0);

      if (playerPoints < requiredPoints) {
        return json(
          { error: "insufficient_table_points", requiredPoints, playerPoints },
          403,
        );
      }
    }
  }
  const callRoomAction = async (
    roomAction: string,
    extra: Record<string, unknown> = {},
  ) => {
    const result = await service.rpc(
      "okey_room_action",
      {
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
      },
    );

    return {
      data: result.data as OkeyRoomSnapshot | null,
      error: result.error,
    };
  };


  let {
    data: room,
    error: roomError,
  } = await callRoomAction(action);

  if (roomError || !room) {
    return json(
      {
        error:
          roomError?.message ??
          "room_action_failed",
      },
      409,
    );
  }


  /*
   * Matchmaking may return an already existing waiting or playing room.
   * Economy must always be selected from the room's actual tableId,
   * not blindly from the tableId supplied in this request.
   */
  if (
    action === "matchmake" &&
    room.status === "waiting"
  ) {
    const economy =
      TABLE_ECONOMY[room.tableId];

    if (!economy) {
      return json(
        {
          error: "room_has_unknown_table",
        },
        409,
      );
    }

    const {
      error: configurationError,
    } = await service.rpc(
      "okey_configure_match",
      {
        p_match_id: room.matchId,
        p_entry_fee: economy.entryFee,
        p_currency: economy.currency,
      },
    );

    if (configurationError) {
      /*
       * Another request may have started the room between matchmake
       * and configure. Refresh before treating it as a real failure.
       */
      const refreshed =
        await callRoomAction("status", {
          p_match_id: room.matchId,
        });

      if (
        refreshed.data?.status === "playing"
      ) {
        room = refreshed.data;
      } else {
        return json(
          {
            error: "match_configuration_failed",
            details:
              configurationError.message,
          },
          409,
        );
      }
    }
  }

  let startedMatch = false;

  if (
    room.status === "waiting" &&
    room.shouldStart
  ) {
    const members = [...room.members].sort(
      (left, right) =>
        left.playerIndex -
        right.playerIndex,
    );

    if (members.length !== 4) {
      return json(
        {
          error: "invalid_room_member_count",
        },
        409,
      );
    }

    const charged = await service.rpc(
      "okey_charge_entry_fee",
      {
        p_match_id: room.matchId,
      },
    );

    if (charged.error) {
      const isInsufficientBalance =
        charged.error.message.includes(
          "insufficient_entry_balance",
        );

      return json(
        {
          error: isInsufficientBalance
            ? "insufficient_entry_balance"
            : "entry_fee_failed",
          details: charged.error.message,
        },
        409,
      );
    }

    const chargeResult =
      (charged.data ?? {}) as ChargeResult;

    /*
     * This invocation owns the debit only when charged === true.
     * If reason is already_charged, another concurrent request may
     * already be starting the same match.
     */
    const chargedByThisRequest =
      chargeResult.charged === true;

    const identities = members.map(
      (member) => ({
        id: member.userId,
        name: member.displayName,
      }),
    );

    const state =
      createAuthoritativeOkeyMatch(
        identities as [
          typeof identities[0],
          typeof identities[0],
          typeof identities[0],
          typeof identities[0],
        ],
      );


    const deadline =
      getNextOkeyMatchTurnDeadline(state);

    const projection =
      projectOkeyMatchPublicState(
        state,
        0,
        deadline,
      );

    const started =
      await callRoomAction("start", {
        p_match_id: room.matchId,
        p_state: state,
        p_projection: projection,
        p_turn_deadline_at: deadline,
      });

    if (
      !started.error &&
      started.data
    ) {
      room = started.data;
      startedMatch = true;
    } else {
      /*
       * Important race protection:
       *
       * Another client may have successfully started this match first.
       * In that case start returns match_already_started, but we must NOT
       * refund or cancel the already playing match.
       */
      const refreshed =
        await callRoomAction("status", {
          p_match_id: room.matchId,
        });

      if (
        refreshed.data?.status === "playing"
      ) {
        room = refreshed.data;
        startedMatch = true;
      } else if (chargedByThisRequest) {
        /*
         * This request charged the players and the match genuinely
         * failed to start, so a full refund is required.
         */
        const refund = await service.rpc(
          "okey_settle_match",
          {
            p_match_id: room.matchId,
            p_winner_team_id: null,
          },
        );

        if (refund.error) {
          return json(
            {
              error:
                "match_start_failed_refund_failed",
              startDetails:
                started.error?.message ??
                "unknown_start_error",
              refundDetails:
                refund.error.message,
            },
            500,
          );
        }

        const afterRefund =
          await callRoomAction("status", {
            p_match_id: room.matchId,
          });

        if (afterRefund.data) {
          room = afterRefund.data;
        }

        return json(
          {
            error: "match_start_failed",
            refunded: true,
            room,
          },
          409,
        );
      } else {
        /*
         * Entry was already charged by another request, but the refreshed
         * room is not playing yet. Do not refund money owned by another
         * concurrent request. The next heartbeat/status call will refresh it.
         */
        return json(
          {
            error: "match_start_in_progress",
            refunded: false,
            room:
              refreshed.data ?? room,
          },
          409,
        );
      }
    }
  }

  if (
    (
      action !== "status" &&
      action !== "heartbeat"
    ) ||
    startedMatch
  ) {
    const channel = service.channel(
      `okey-room:${room.matchId}`,
    );

    await channel.send({
      type: "broadcast",
      event: "invalidate",
      payload: {
        matchId: room.matchId,
        status: room.status,
        version: room.version,
      },
    });

    await service.removeChannel(channel);
  }

  return json({
    room: withTableEconomy(room),
  });
});