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
  if (room.tableId === "preview-test") {
    return { ...room, entryFee: 0, currency: "fun" };
  }
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
      "active-memberships",
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
    action !== "active-memberships" &&
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

  const { data: currentProfile, error: currentProfileError } = await service
    .from("profiles")
    .select("username")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (currentProfileError) {
    return json({ error: "profile_lookup_failed", details: currentProfileError.message }, 500);
  }
  const displayName = currentProfile?.username ?? "Player";

  if (["heartbeat", "reconnect"].includes(action)) {
    const { data: membership, error: membershipError } = await service
      .schema("okey")
      .from("match_seats")
      .select("membership_released_at, membership_release_reason")
      .eq("match_id", body.matchId)
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (membershipError) {
      return json({ error: "membership_lookup_failed", details: membershipError.message }, 500);
    }

    if (membership?.membership_released_at) {
      return json({
        error: "membership_released",
        reason: membership.membership_release_reason,
      }, 403);
    }
  }
  if (action === "active-memberships") {
    const { data: membershipRows, error: membershipsError } = await service.rpc(
      "get_active_okey_memberships",
      { p_user_id: authData.user.id },
    );

    if (membershipsError) {
      return json({ error: "active_memberships_failed", details: membershipsError.message }, 500);
    }

    return json({
      memberships: (membershipRows ?? []).map((membership: any) => ({
        matchId: String(membership.match_id),
        playerIndex: Number(membership.player_index),
        status: membership.status,
      })),
    });
  }
  let activeParty: {
    id: string;
    leader_id: string;
    flow_status: string;
  } | null = null;
  let partyMembers: Array<{ user_id: string; role: string }> = [];

  if (action === "matchmake" || action === "leave") {
    const partyResult = await authClient.rpc("get_my_domino_party");

    if (partyResult.error) {
      console.error("Unable to load game party", partyResult.error);
      return json({
        error: "party_lookup_failed",
        details: partyResult.error.message,
      }, 500);
    }

    const party = partyResult.data as Record<string, unknown> | null;
    if (party?.id) {
      activeParty = {
        id: String(party.id),
        leader_id: String(party.leader_id),
        flow_status: String(party.flow_status ?? "idle"),
      };
      partyMembers = Array.isArray(party.members)
        ? party.members.map((member: Record<string, unknown>) => ({
            user_id: String(member.user_id),
            role: String(member.role),
          }))
        : [];
    }
  }
  if (action === "matchmake" && activeParty) {
    if (activeParty.leader_id !== authData.user.id) {
      return json({ error: "party_leader_required" }, 403);
    }
    if (partyMembers.length !== 2) {
      return json({ error: "invalid_party_size" }, 409);
    }

    const partyUserIds = partyMembers.map((member) => member.user_id);
    const economy = TABLE_ECONOMY[String(body.tableId)];
    const [presenceResult, walletResult, profileResult] = await Promise.all([
      service.from("user_presence")
        .select("user_id, status, last_seen_at").in("user_id", partyUserIds),
      service.from("wallets")
        .select("user_id, coin, mc").in("user_id", partyUserIds),
      service.from("profiles")
        .select("id, points").in("id", partyUserIds),
    ]);
    if (presenceResult.error || walletResult.error || profileResult.error) {
      const failedLookup = presenceResult.error
        ? `presence: ${presenceResult.error.message}`
        : walletResult.error
          ? `wallet: ${walletResult.error.message}`
          : `profile: ${profileResult.error?.message ?? "unknown_error"}`;
      console.error("Party eligibility lookup failed", {
        presence: presenceResult.error,
        wallet: walletResult.error,
        profile: profileResult.error,
      });
      return json({
        error: "party_eligibility_lookup_failed",
        details: failedLookup,
      }, 500);
    }

    const cutoff = Date.now() - 35_000;
    const allAvailable = partyUserIds.every((userId) => {
      const presence = presenceResult.data?.find((row) => row.user_id === userId);
      return presence?.status === "online_available" &&
        Date.parse(presence.last_seen_at) >= cutoff;
    });
    if (!allAvailable) return json({ error: "party_member_unavailable" }, 409);

    const allFunded = partyUserIds.every((userId) => {
      const wallet = walletResult.data?.find((row) => row.user_id === userId);
      return Number(economy.currency === "aznif" ? wallet?.mc : wallet?.coin) >=
        economy.entryFee;
    });
    if (!allFunded) {
      return json({ error: "party_member_insufficient_entry_balance" }, 409);
    }

    if ((economy.minPoints ?? 0) > 0) {
      const allQualified = partyUserIds.every((userId) => {
        const profile = profileResult.data?.find((row) => row.id === userId);
        return Number(profile?.points ?? 0) >= (economy.minPoints ?? 0);
      });
      if (!allQualified) {
        return json({ error: "party_member_insufficient_table_points" }, 409);
      }
    }
  }
  /*
   * Fun-table Point requirements are an admission rule, not a match reward.
   * Check them before joining the room so this cannot be bypassed by calling
   * the Edge Function directly instead of using the lobby UI.
   */
  if (action === "matchmake") {
    const economy = TABLE_ECONOMY[String(body.tableId)];

    if (economy?.currency === "fun" && (economy.minPoints ?? 0) > 0) {
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


  if (action === "leave" && activeParty && activeParty.leader_id !== authData.user.id) {
    const waitingRoom = await callRoomAction("status", {
      p_match_id: body.matchId,
    });
    if (waitingRoom.data?.status === "waiting") {
      return json({ error: "party_leader_required" }, 403);
    }
  }
  let room: OkeyRoomSnapshot | null = null;
  let roomError: { message: string } | null = null;

  if (action === "matchmake" && activeParty) {
    const teammate = partyMembers.find((member) => member.user_id !== authData.user.id);
    if (!teammate) return json({ error: "invalid_party_size" }, 409);
    const teammateProfile = await service.from("profiles").select("username, avatar_id")
      .eq("id", teammate.user_id).maybeSingle();
    if (teammateProfile.error) return json({ error: "party_member_profile_failed" }, 500);
    const economy = TABLE_ECONOMY[String(body.tableId)];
    const allocation = await service.rpc("matchmake_okey_party", {
      p_party_id: activeParty.id, p_leader_id: authData.user.id, p_member_id: teammate.user_id,
      p_table_id: String(body.tableId), p_leader_name: displayName, p_leader_avatar: avatarUrl,
      p_member_name: teammateProfile.data?.username ?? "Player",
      p_member_avatar: teammateProfile.data?.avatar_id ?? null,
      p_currency: economy.currency, p_entry_fee: economy.entryFee,
    });
    if (allocation.error || !allocation.data) {
      return json({ error: "party_room_assignment_failed", details: allocation.error?.message }, 409);
    }
    const snapshot = await callRoomAction("status", { p_match_id: String(allocation.data) });
    room = snapshot.data; roomError = snapshot.error;
  } else {
    const result = await callRoomAction(action);
    room = result.data; roomError = result.error;
  }
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


  if (
    room.status === "waiting" &&
    room.memberCount === 4 &&
    room.connectedCount === 4 &&
    room.countdownEndsAt &&
    Date.parse(room.countdownEndsAt) <= Date.now()
  ) {
    const confirmation = await service.rpc(
      "okey_confirm_server_countdown",
      { p_match_id: room.matchId },
    );

    if (confirmation.error) {
      return json({
        error: "countdown_confirmation_failed",
        details: confirmation.error.message,
      }, 500);
    }

    if (confirmation.data === true) {
      const refreshed = await callRoomAction("status", {
        p_match_id: room.matchId,
      });
      if (refreshed.error || !refreshed.data) {
        return json({
          error: "countdown_status_refresh_failed",
          details: refreshed.error?.message,
        }, 500);
      }
      room = refreshed.data;
    }
  }


  if (
    action === "leave" && activeParty &&
    activeParty.leader_id === authData.user.id && room.status === "waiting"
  ) {
    const teammate = partyMembers.find((member) => member.user_id !== authData.user.id);
    if (teammate) {
      await callRoomAction("leave", {
        p_user_id: teammate.user_id,
        p_match_id: body.matchId,
      });
    }
    await service.from("domino_parties").update({
      flow_status: "idle",
      command_version: Date.now(),
      updated_at: new Date().toISOString(),
    }).eq("id", activeParty.id);
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

    let startFailureDetails: string | null = null;

    try {
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
        startFailureDetails =
          started.error?.message ??
          "start_returned_no_room";
      }
    } catch (error) {
      startFailureDetails =
        error instanceof Error
          ? error.message
          : "unknown_start_error";
    }

    if (!startedMatch) {
      /*
       * Important race protection:
       *
       * Another client may have successfully started this match first.
       * In that case start returns match_already_started, but we must NOT
       * refund or cancel the already playing match.
       */
      let refreshed: Awaited<
        ReturnType<typeof callRoomAction>
      > | null = null;

      try {
        refreshed =
          await callRoomAction("status", {
            p_match_id: room.matchId,
          });
      } catch (error) {
        const refreshDetails =
          error instanceof Error
            ? error.message
            : "unknown_status_refresh_error";

        console.error(
          "Okey match start failed and status refresh failed",
          {
            matchId: room.matchId,
            startDetails: startFailureDetails,
            refreshDetails,
          },
        );

        return json(
          {
            error: "match_start_status_refresh_failed",
            startDetails: startFailureDetails,
            refreshDetails,
          },
          500,
        );
      }

      if (refreshed.error || !refreshed.data) {
        const refreshDetails =
          refreshed.error?.message ??
          "status_refresh_returned_no_room";

        console.error(
          "Okey match start failed and status refresh failed",
          {
            matchId: room.matchId,
            startDetails: startFailureDetails,
            refreshDetails,
          },
        );

        return json(
          {
            error: "match_start_status_refresh_failed",
            startDetails: startFailureDetails,
            refreshDetails,
          },
          500,
        );
      }

      if (refreshed.data.status === "playing") {
        room = refreshed.data;
        startedMatch = true;
      } else if (
        chargedByThisRequest &&
        refreshed.data.status === "waiting"
      ) {
        /*
         * This request charged the players and the match genuinely
         * failed to start, so the dedicated cancellation RPC must return
         * every charged entry in its original currency.
         */
        let refundError: string | null = null;

        try {
          const refund = await service.rpc(
            "okey_cancel_match_and_refund",
            {
              p_match_id: room.matchId,
              p_cancel_reason: "match_start_failed",
            },
          );

          refundError =
            refund.error?.message ?? null;
        } catch (error) {
          refundError =
            error instanceof Error
              ? error.message
              : "unknown_refund_error";
        }

        if (refundError) {
          console.error(
            "Okey match start failed and refund failed",
            {
              matchId: room.matchId,
              startDetails: startFailureDetails,
              refundDetails: refundError,
            },
          );

          return json(
            {
              error:
                "match_start_failed_refund_failed",
              startDetails: startFailureDetails,
              refundDetails: refundError,
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
      } else if (!chargedByThisRequest) {
        /*
         * Entry was already charged by another request, but the refreshed
         * room is not playing yet. Do not refund money owned by another
         * concurrent request. The next heartbeat/status call will refresh it.
         */
        return json(
          {
            error: "match_start_in_progress",
            refunded: false,
            room: refreshed.data,
          },
          409,
        );
      } else {
        console.error(
          "Okey match start failed with an unexpected room status",
          {
            matchId: room.matchId,
            startDetails: startFailureDetails,
            roomStatus: refreshed.data.status,
          },
        );

        return json(
          {
            error: "match_start_failed_unexpected_status",
            startDetails: startFailureDetails,
            room: refreshed.data,
          },
          500,
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
