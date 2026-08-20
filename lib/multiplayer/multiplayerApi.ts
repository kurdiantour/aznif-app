import { supabase } from "@/lib/supabase";
import { createMultiplayerCommandClient } from "@/lib/multiplayer/core/http-command-client";


export { MultiplayerRequestError } from "@/lib/multiplayer/core/http-command-client";

export type TurnTimeoutClaim = {
  expectedVersion: number;
  expectedTurnStartedAt: string;
  expectedTurnPlayerId: string;
};

type Tile = {
  id: string;
  left: number;
  right: number;
  imageKey?: string;
};

const EXPECTED_MULTIPLAYER_CODES = new Set([
  "turn_timer_not_expired",
  "stale_timeout",
  "already_processed",
]);

const submitMultiplayerRequest = createMultiplayerCommandClient({
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  getBaseUrl: () => process.env.EXPO_PUBLIC_SUPABASE_URL,
  expectedErrorCodes: EXPECTED_MULTIPLAYER_CODES,
});

export type DominoBotTurnMode = "1v1" | "2v2";

export async function processDominoBotTurns(
  mode: DominoBotTurnMode,
  roomId: string,
) {
  const { data, error } = await supabase.functions.invoke("process_bot_turns", {
    body: { mode, room_id: roomId },
  });
  if (error) throw error;
  return data;
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