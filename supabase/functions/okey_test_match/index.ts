import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
  projectOkeyMatchPublicState,
  type OkeyServerPlayerIdentity,
} from "../../../okey/server/okey-authoritative.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const randomPassword = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(48)), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");

type PreviewSeat = {
  user_id: string;
  player_index: number;
  display_name: string;
  bot_since: string | null;
};

type PreviewJoinResult = {
  matchId: string;
  status: "waiting" | "playing";
  readyToStart: boolean;
  resumed: boolean;
};

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");

  if (!url || !anon || !serviceKey) {
    return json({ error: "server_configuration_incomplete" }, 503);
  }

  if (!authorization) {
    return json({ error: "unauthorized" }, 401);
  }

  const caller = createClient(url, anon, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
    auth: {
      persistSession: false,
    },
  });

  const { data: authData, error: authError } =
    await caller.auth.getUser();

  if (authError || !authData.user) {
    return json({ error: "unauthorized" }, 401);
  }

  const service = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
    },
  });

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("username, is_admin")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    return json(
      {
        error: "profile_lookup_failed",
        details: profileError.message,
      },
      500,
    );
  }

  if (!profile?.is_admin) {
    return json(
      {
        error: "admin_test_access_required",
      },
      403,
    );
  }

  /*
   * Preview جدید فقط به دو Bot نیاز دارد.
   * Slot 3 قدیمی دست‌نخورده باقی می‌ماند.
   */
  const { data: configured, error: configuredError } =
    await service
      .schema("okey")
      .from("test_bot_accounts")
      .select("slot, user_id")
      .in("slot", [1, 2])
      .order("slot");

  if (configuredError) {
    return json(
      {
        error: "test_bot_lookup_failed",
        details: configuredError.message,
      },
      500,
    );
  }

  const bots = new Map<number, string>(
    (configured ?? []).map((row) => [
      Number(row.slot),
      String(row.user_id),
    ]),
  );

  /*
   * فقط در صورتی که یکی از دو Bot تست وجود نداشته باشد
   * همان Bot ساخته می‌شود.
   */
  for (let slot = 1; slot <= 2; slot += 1) {
    if (bots.has(slot)) {
      continue;
    }

    const { data: created, error } =
      await service.auth.admin.createUser({
        email: `okey-test-bot-${slot}@internal.invalid`,
        password: randomPassword(),
        email_confirm: true,

        app_metadata: {
          system_account: true,
          okey_test_bot: true,
          okey_test_bot_slot: slot,
        },

        user_metadata: {
          username: `Test Bot ${slot}`,
        },
      });

    if (error || !created.user) {
      return json(
        {
          error: "test_bot_provision_failed",
          slot,
          details: error?.message,
        },
        500,
      );
    }

    const registered = await service
      .schema("okey")
      .from("test_bot_accounts")
      .insert({
        slot,
        user_id: created.user.id,
      });

    if (registered.error) {
      await service.auth.admin
        .deleteUser(created.user.id)
        .catch(() => undefined);

      return json(
        {
          error: "test_bot_registration_failed",
          slot,
          details: registered.error.message,
        },
        500,
      );
    }

    bots.set(slot, created.user.id);
  }

  const botIds = [1, 2].map(
    (slot) => bots.get(slot)!,
  );

  /*
   * Admin اول:
   *   seat 0 = Admin
   *   seat 1 = Bot
   *   seat 2 = empty
   *   seat 3 = Bot
   *
   * Admin دوم:
   *   seat 2 = Admin
   */
  const joined = await service.rpc(
    "okey_preview_test_join_or_create",
    {
      p_user_id: authData.user.id,
      p_bot_user_ids: botIds,
    },
  );

  if (
    joined.error ||
    !joined.data ||
    typeof joined.data !== "object"
  ) {
    return json(
      {
        error: "test_waiting_match_failed",
        details: joined.error?.message,
      },
      500,
    );
  }

  const room =
    joined.data as PreviewJoinResult;

  if (typeof room.matchId !== "string") {
    return json(
      {
        error: "invalid_test_waiting_match_response",
      },
      500,
    );
  }

  /*
   * Admin اول همین matchId را دریافت می‌کند و وارد
   * WaitingPlayersPopup می‌شود.
   *
   * اگر Match قبلاً Playing باشد نیز فقط Resume می‌کنیم.
   */
  if (
    room.status === "playing" ||
    !room.readyToStart
  ) {
    return json(
      {
        matchId: room.matchId,
        resumed: room.resumed,
        status: room.status,
      },
      room.resumed ? 200 : 201,
    );
  }

  /*
   * اگر به اینجا رسیدیم یعنی:
   *
   * seat 0 = Admin 1
   * seat 1 = Bot 1
   * seat 2 = Admin 2
   * seat 3 = Bot 2
   *
   * پس Server می‌تواند authoritative state را بسازد.
   */
  const { data: seatRows, error: seatError } =
    await service
      .schema("okey")
      .from("match_seats")
      .select(
        "user_id, player_index, display_name, bot_since",
      )
      .eq("match_id", room.matchId)
      .is("membership_released_at", null)
      .order("player_index");

  if (seatError) {
    return json(
      {
        error: "test_seat_lookup_failed",
        details: seatError.message,
      },
      500,
    );
  }

  const seats =
    (seatRows ?? []) as PreviewSeat[];

  if (
    seats.length !== 4 ||
    seats.some(
      (seat, index) =>
        Number(seat.player_index) !== index,
    )
  ) {
    return json(
      {
        error: "test_match_seats_incomplete",
      },
      409,
    );
  }

  const identities = seats.map((seat) => {
    const isBot =
      seat.player_index === 1 ||
      seat.player_index === 3;

    const botNumber =
      seat.player_index === 1
        ? 1
        : seat.player_index === 3
          ? 2
          : undefined;

    return {
      id: seat.user_id,

      name:
        seat.display_name ||
        (isBot
          ? `Test Bot ${botNumber}`
          : "Test Player"),

      ...(isBot
        ? {
            controlledByBot: true,
            botDifficulty: "normal" as const,
            botNumber,
          }
        : {}),
    };
  }) as [
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
  ];

  const state =
    createAuthoritativeOkeyMatch(
      identities,
    );

  const deadline =
    getNextOkeyMatchTurnDeadline(
      state,
    );

  const projection =
    projectOkeyMatchPublicState(
      state,
      0,
      deadline,
    );

  /*
   * Start نهایی فقط Server-side و داخل RPC مخصوص
   * Preview انجام می‌شود.
   */
  const started = await service.rpc(
    "okey_preview_test_start",
    {
      p_actor_user_id:
        authData.user.id,

      p_match_id:
        room.matchId,

      p_state:
        state,

      p_projection:
        projection,

      p_turn_deadline_at:
        deadline,
    },
  );

  if (
    started.error ||
    typeof started.data !== "string"
  ) {
    return json(
      {
        error: "test_match_start_failed",
        details: started.error?.message,
      },
      500,
    );
  }

  const matchId = started.data;

  /*
   * همان Realtime contract فعلی Okey.
   */
  const channel =
    service.channel(
      `okey-match:${matchId}`,
    );

  await channel.send({
    type: "broadcast",
    event: "state_update",

    payload: {
      matchId,
      commandId: crypto.randomUUID(),
      version: 0,
      publicProjection: projection,
      actionEvents: [],
    },
  });

  await service.removeChannel(
    channel,
  );

  return json(
    {
      matchId,
      resumed: room.resumed,
      status: "playing",
    },
    201,
  );
});