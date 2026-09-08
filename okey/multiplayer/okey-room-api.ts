import { supabase } from "@/lib/supabase";
import { AppState } from "react-native";

const COUNTDOWN_START_CLOCK_SAFETY_MS = 75;
const COUNTDOWN_START_RETRY_MS = 500;

export function getOkeyCountdownStartCheckDelay(
  countdownEndsAt: string,
  now = Date.now(),
) {
  const deadline = Date.parse(countdownEndsAt);

  if (!Number.isFinite(deadline)) {
    return null;
  }

  const remaining = deadline - now;

  return remaining > 0
    ? remaining + COUNTDOWN_START_CLOCK_SAFETY_MS
    : COUNTDOWN_START_RETRY_MS;
}

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
    let errorBody: {
      error?: string;
      details?: string;
    } | null = null;

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
        : errorBody?.error ??
            error.message ??
            "okey_room_request_failed",
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

export function subscribeOkeyWaitingRoomHeartbeat(
  matchId: string,
  listener: (room: OkeyRoomSnapshot) => void,
  onError?: (error: Error) => void,
) {
  let active = true;
  let heartbeatInFlight = false;

  const reportError = (error: unknown) => {
    if (!active || !onError) {
      return;
    }

    onError(
      error instanceof Error
        ? error
        : new Error("okey_waiting_room_heartbeat_failed"),
    );
  };

  const heartbeat = async () => {
    if (
      !active ||
      heartbeatInFlight ||
      AppState.currentState !== "active"
    ) {
      return;
    }

    heartbeatInFlight = true;

    try {
      const room = await heartbeatOkeyRoom(matchId);

      if (active) {
        listener(room);
      }
    } catch (error) {
      reportError(error);
    } finally {
      heartbeatInFlight = false;
    }
  };

  void heartbeat();

  const heartbeatTimer = setInterval(
    () => void heartbeat(),
    60_000,
  );

  const appStateSubscription =
    AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          void heartbeat();
        }
      },
    );

  return () => {
    active = false;
    clearInterval(heartbeatTimer);
    appStateSubscription.remove();
  };
}

export function subscribeOkeyRoom(
  matchId: string,
  listener: (room: OkeyRoomSnapshot) => void,
  onError?: (error: Error) => void,
) {
  let active = true;
  let refreshInFlight: Promise<void> | null = null;
  let countdownStartTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledCountdownDeadline: string | null = null;
  let countdownAwaitingStart = false;

  const clearCountdownStartTimer = () => {
    if (countdownStartTimer) {
      clearTimeout(countdownStartTimer);
    }

    countdownStartTimer = null;
    scheduledCountdownDeadline = null;
  };

  const deliver = (room: OkeyRoomSnapshot) => {
    countdownAwaitingStart =
      room.status === "waiting" &&
      room.countdownEndsAt !== null;

    scheduleCountdownStartCheck(room);
    listener(room);
  };

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
          deliver(room);
        }
      })
      .catch((error) => {
        reportError(error);
        scheduleCountdownStartRetry();
      })
      .finally(() => {
        refreshInFlight = null;
      });

    return refreshInFlight;
  };

  const runCountdownStartCheck = async () => {
    const pendingRefresh = refreshInFlight;

    if (pendingRefresh) {
      await pendingRefresh;
    }

    if (active) {
      await refresh();
    }
  };

  function scheduleCountdownStartRetry() {
    if (
      !active ||
      !countdownAwaitingStart ||
      countdownStartTimer
    ) {
      return;
    }

    scheduledCountdownDeadline = null;

    countdownStartTimer = setTimeout(() => {
      countdownStartTimer = null;
      void runCountdownStartCheck();
    }, 500);
  }

  function scheduleCountdownStartCheck(
    room: OkeyRoomSnapshot,
  ) {
    if (
      room.status !== "waiting" ||
      !room.countdownEndsAt
    ) {
      clearCountdownStartTimer();
      return;
    }

    if (
      scheduledCountdownDeadline === room.countdownEndsAt &&
      countdownStartTimer
    ) {
      return;
    }

    clearCountdownStartTimer();

    const delay = getOkeyCountdownStartCheckDelay(
      room.countdownEndsAt,
    );

    if (delay === null) {
      return;
    }

    scheduledCountdownDeadline = room.countdownEndsAt;

    countdownStartTimer = setTimeout(() => {
      countdownStartTimer = null;
      scheduledCountdownDeadline = null;
      void runCountdownStartCheck();
    }, delay);
  }

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
        void refresh();
      }
    });

  return () => {
    active = false;
    clearCountdownStartTimer();
    void supabase.removeChannel(channel);
  };
}

export type OkeyActiveMembership = {
  matchId: string;
  playerIndex: number;
  status: "waiting" | "playing";
};

export async function getActiveOkeyMemberships(): Promise<
  OkeyActiveMembership[]
> {
  const { data, error } =
    await supabase.functions.invoke("okey_room", {
      body: {
        action: "active-memberships",
      },
    });

  if (error) {
    let errorBody: {
      error?: string;
      details?: string;
    } | null = null;

    try {
      if ("context" in error && error.context) {
        errorBody = await error.context.json();
      }
    } catch {
      errorBody = null;
    }

    throw new Error(
      errorBody?.details
        ? `${errorBody.error ?? "okey_active_memberships_failed"}: ${errorBody.details}`
        : errorBody?.error ??
            error.message ??
            "okey_active_memberships_failed",
    );
  }

  if (
    !data ||
    !Array.isArray(data.memberships)
  ) {
    throw new Error(
      "okey_active_memberships_response_invalid",
    );
  }

  return data.memberships as OkeyActiveMembership[];
}