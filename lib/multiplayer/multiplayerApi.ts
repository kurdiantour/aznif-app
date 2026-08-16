import { supabase } from "@/lib/supabase";

type Tile = {
  id: string;
  left: number;
  right: number;
  imageKey?: string;
};

type RequestBody = Record<string, unknown>;
const MULTIPLAYER_REQUEST_TIMEOUT_MS = 15_000;
const EXPECTED_MULTIPLAYER_CODES = new Set([
  "turn_timer_not_expired",
  "stale_timeout",
  "already_processed",
]);

export type TurnTimeoutClaim = {
  expectedVersion: number;
  expectedTurnStartedAt: string;
  expectedTurnPlayerId: string;
};

export type DrawTimeoutClaim = {
  expectedVersion: number;
  expectedDrawStartedAt: string;
  expectedTurnPlayerId: string;
};

export class MultiplayerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly ambiguous: boolean,
    readonly code: string | null = null,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "MultiplayerRequestError";
  }
}

async function submitMultiplayerRequest(
  functionName: string,
  body: RequestBody,
) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    throw new Error("User not authenticated");
  }

  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");

  if (!baseUrl) {
    throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");
  }

  let res: Response;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    MULTIPLAYER_REQUEST_TIMEOUT_MS,
  );

  try {
    res = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: any) {
    throw new MultiplayerRequestError(
      error?.message ?? `${functionName} request failed`,
      null,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  let responseText: string;
  try {
    responseText = await res.text();
  } catch (error: any) {
    throw new MultiplayerRequestError(
      error?.message ?? `${functionName} response failed`,
      null,
      true,
    );
  }

  let json: any = null;

  try {
    json = responseText ? JSON.parse(responseText) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const code = typeof json?.code === "string" ? json.code : null;
    const expected = code !== null && EXPECTED_MULTIPLAYER_CODES.has(code);

    if (!expected) {
      console.warn(`${functionName} failed`, {
        status: res.status,
        statusText: res.statusText,
        code,
        error: json?.error ?? null,
        details: json?.details ?? null,
        rawResponse: responseText,
      });
    }

    throw new MultiplayerRequestError(
      json?.error || responseText || `${functionName} failed`,
      res.status,
      false,
      code,
      json && typeof json === "object" ? json : null,
    );
  }

  return json;
}

export async function submitOneVsOneMove(
  roomId: string,
  tile: Tile,
  branch?: string,
) {
  return submitMultiplayerRequest("submit_one_vs_one", {
    action: "move",
    room_id: roomId,
    tile,
    branch,
  });
}

export async function submitOneVsOnePass(
  roomId: string,
  timedOut = false,
  timeoutClaim?: TurnTimeoutClaim,
) {
  return submitMultiplayerRequest("submit_one_vs_one", {
    action: "pass",
    room_id: roomId,
    timed_out: timedOut,
    ...(timeoutClaim
      ? {
          expected_version: timeoutClaim.expectedVersion,
          expected_turn_started_at: timeoutClaim.expectedTurnStartedAt,
          expected_turn_player_id: timeoutClaim.expectedTurnPlayerId,
        }
      : {}),
  });
}

export async function submitOneVsOneDraw(
  roomId: string,
  timedOut = false,
  timeoutClaim?: DrawTimeoutClaim,
) {
  return submitMultiplayerRequest("submit_one_vs_one", {
    action: "draw",
    room_id: roomId,
    timed_out: timedOut,
    ...(timeoutClaim
      ? {
          expected_version: timeoutClaim.expectedVersion,
          expected_draw_started_at: timeoutClaim.expectedDrawStartedAt,
          expected_turn_player_id: timeoutClaim.expectedTurnPlayerId,
        }
      : {}),
  });
}

export async function submitTwoVsTwoMove(
  roomId: string,
  tile: Tile,
  branch?: string,
) {
  return submitMultiplayerRequest("submit_two_vs_two", {
    action: "move",
    room_id: roomId,
    tile,
    branch,
  });
}

export async function submitTwoVsTwoPass(
  roomId: string,
  timedOut = false,
  timeoutClaim?: TurnTimeoutClaim,
) {
  return submitMultiplayerRequest("submit_two_vs_two", {
    action: "pass",
    room_id: roomId,
    timed_out: timedOut,
    ...(timeoutClaim
      ? {
          expected_version: timeoutClaim.expectedVersion,
          expected_turn_started_at: timeoutClaim.expectedTurnStartedAt,
          expected_turn_player_id: timeoutClaim.expectedTurnPlayerId,
        }
      : {}),
  });
}