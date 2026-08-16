import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (request.method !== "POST") {
    return reply(
      {
        error: "method_not_allowed",
      },
      405,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return reply(
      {
        error: "server_not_configured",
      },
      500,
    );
  }

  if (!authorization) {
    return reply(
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
    return reply(
      {
        error: "unauthorized",
      },
      401,
    );
  }

  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return reply(
      {
        error: "invalid_json",
      },
      400,
    );
  }

  const action = String(body.action ?? "");

  if (action !== "list" && action !== "send") {
    return reply(
      {
        error: "invalid_action",
      },
      400,
    );
  }

  if (!isUuid(body.matchId)) {
    return reply(
      {
        error: "invalid_match_id",
      },
      400,
    );
  }

  const matchId = body.matchId;
  const userId = authData.user.id;

  const service = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
    },
  });

  const {
    data: participant,
    error: participantError,
  } = await service
    .schema("okey")
    .from("match_seats")
    .select("user_id")
    .eq("match_id", matchId)
    .eq("user_id", userId)
    .maybeSingle();

  if (participantError) {
    console.error(
      "Okey chat participant check failed",
      participantError,
    );

    return reply(
      {
        error: "participant_check_failed",
      },
      500,
    );
  }

  if (!participant) {
    return reply(
      {
        error: "not_a_participant",
      },
      403,
    );
  }

  if (action === "list") {
    const {
      data: messages,
      error: messagesError,
    } = await service
      .schema("okey")
      .from("match_chat_messages")
      .select(
        "id, match_id, user_id, body, created_at",
      )
      .eq("match_id", matchId)
      .order("created_at", {
        ascending: false,
      })
      .order("id", {
        ascending: false,
      })
      .limit(100);

    if (messagesError) {
      console.error(
        "Okey chat load failed",
        messagesError,
      );

      return reply(
        {
          error: "chat_load_failed",
        },
        500,
      );
    }

    return reply({
      messages: (messages ?? []).reverse(),
    });
  }

  const messageBody =
    typeof body.body === "string"
      ? body.body.trim().slice(0, 500)
      : "";

  if (!messageBody) {
    return reply(
      {
        error: "invalid_message",
      },
      400,
    );
  }

  const {
    data: message,
    error: messageError,
  } = await service.rpc(
    "okey_post_chat_message",
    {
      p_match_id: matchId,
      p_user_id: userId,
      p_body: messageBody,
    },
  );

  if (messageError) {
    console.error(
      "Okey chat send failed",
      messageError,
    );

    return reply(
      {
        error: "chat_send_failed",
      },
      409,
    );
  }

  const channel = service.channel(
    `okey-chat:${matchId}`,
  );

  await channel.send({
    type: "broadcast",
    event: "invalidate",
    payload: {
      matchId,
    },
  });

  await service.removeChannel(channel);

  return reply({
    message,
  });
});