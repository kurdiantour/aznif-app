import { supabase } from "@/lib/supabase";

export type OkeyRoomMember = {
  userId: string;
  playerIndex: number;
  teamId: "teamA" | "teamB";
  displayName: string;
  avatarUrl: string | null;
  connected: boolean;
};

export type OkeyRoomSnapshot = {
  matchId: string;
  roomCode: string;
  tableId: string;
  entryFee: number;
  currency: "fun" | "aznif";
  status: "waiting" | "playing" | "finished" | "cancelled";
  version: number;
  memberCount: number;
  connectedCount: number;
  confirmedCount: number;
  countdownEndsAt: string | null;
  shouldStart: boolean;
  members: OkeyRoomMember[];
};

export type OkeyChatMessage = {
  id: string;
  match_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

async function chatAction(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("okey_chat", { body });

  if (error) {
    throw new Error(error.message || "okey_chat_request_failed");
  }

  if (!data || typeof data !== "object") {
    throw new Error("okey_chat_response_invalid");
  }

  if ("error" in data && data.error) {
    throw new Error(String(data.error));
  }

  return data as Record<string, unknown>;
}

export async function getOkeyChatMessages(matchId: string): Promise<OkeyChatMessage[]> {
  const data = await chatAction({ action: "list", matchId });
  return Array.isArray(data.messages) ? data.messages as OkeyChatMessage[] : [];
}

export async function sendOkeyChatMessage(matchId: string, body: string): Promise<OkeyChatMessage> {
  const data = await chatAction({ action: "send", matchId, body });
  if (!data.message) throw new Error("okey_chat_response_invalid");
  return data.message as OkeyChatMessage;
}

export function subscribeOkeyChat(matchId: string, listener: () => void) {
  const channel = supabase
    .channel(`okey-chat:${matchId}`)
    .on("broadcast", { event: "invalidate" }, listener)
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
async function roomAction(
  body: Record<string, unknown>,
): Promise<OkeyRoomSnapshot> {
  const { data, error } = await supabase.functions.invoke(
    "okey_room",
    {
      body,
    },
  );

  if (error) {
    let errorBody: { error?: string; details?: string } | null = null;

    try {
      if ("context" in error && error.context) {
        errorBody = await error.context.json();
      }
    } catch {
      errorBody = null;
    }

    throw new Error(
      errorBody?.details
        ? `${errorBody.error ?? "okey_room_request_failed"}: ${errorBody.details}`
        : errorBody?.error ?? error.message ?? "okey_room_request_failed",
    );
  }

  if (!data?.room) {
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : "okey_room_response_invalid",
    );
  }

  return data.room as OkeyRoomSnapshot;
}

export function matchmakeOkeyRoom(
  tableId: string,
): Promise<OkeyRoomSnapshot> {
  return roomAction({
    action: "matchmake",
    tableId,
  });
}

export function getOkeyRoomStatus(
  matchId: string,
): Promise<OkeyRoomSnapshot> {
  return roomAction({
    action: "status",
    matchId,
  });
}

export function heartbeatOkeyRoom(
  matchId: string,
): Promise<OkeyRoomSnapshot> {
  return roomAction({
    action: "heartbeat",
    matchId,
  });
}

export function reconnectOkeyRoom(
  matchId: string,
): Promise<OkeyRoomSnapshot> {
  return roomAction({
    action: "reconnect",
    matchId,
  });
}

export function leaveOkeyRoom(
  matchId: string,
): Promise<OkeyRoomSnapshot> {
  return roomAction({
    action: "leave",
    matchId,
  });
}

export function subscribeOkeyRoom(
  matchId: string,
  listener: (room: OkeyRoomSnapshot) => void,
  onError?: (error: Error) => void,
) {
  let active = true;
  let refreshInFlight: Promise<void> | null = null;
  let heartbeatInFlight: Promise<void> | null = null;

  const reportError = (error: unknown) => {
    if (!active || !onError) {
      return;
    }

    onError(
      error instanceof Error
        ? error
        : new Error("okey_room_subscription_failed"),
    );
  };

  const refresh = () => {
    if (!active || refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = getOkeyRoomStatus(matchId)
      .then((room) => {
        if (active) {
          listener(room);
        }
      })
      .catch(reportError)
      .finally(() => {
        refreshInFlight = null;
      });

    return refreshInFlight;
  };

  const heartbeat = () => {
    if (!active || heartbeatInFlight) {
      return heartbeatInFlight;
    }

    heartbeatInFlight = heartbeatOkeyRoom(matchId)
      .then((room) => {
        if (active) {
          listener(room);
        }
      })
      .catch(reportError)
      .finally(() => {
        heartbeatInFlight = null;
      });

    return heartbeatInFlight;
  };

  const channel = supabase
    .channel(`okey-room:${matchId}`)
    .on(
      "broadcast",
      {
        event: "invalidate",
      },
      () => {
        void refresh();
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void heartbeat();
      }
    });

  const heartbeatTimer = setInterval(() => {
    void heartbeat();
  }, 1_500);

  return () => {
    active = false;
    clearInterval(heartbeatTimer);
    void supabase.removeChannel(channel);
  };
}