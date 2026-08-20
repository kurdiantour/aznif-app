import { supabase } from "@/lib/supabase";
import { createMultiplayerCommandClient } from "@/lib/multiplayer/core/http-command-client";
import type {
  DominoOneVsOneDrawTimeoutClaim,
  DominoOneVsOneTurnTimeoutClaim,
} from "./domino-one-vs-one-adapter";
import type { DominoTileData, KozelBranch } from "@/types/game";

const EXPECTED_COMMAND_CODES = new Set([
  "turn_timer_not_expired",
  "stale_timeout",
  "already_processed",
]);

const submitCommand = createMultiplayerCommandClient({
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  getBaseUrl: () => process.env.EXPO_PUBLIC_SUPABASE_URL,
  expectedErrorCodes: EXPECTED_COMMAND_CODES,
});

export async function processDominoOneVsOneBotTurn(roomId: string) {
  const { data, error } = await supabase.functions.invoke("process_bot_turns", {
    body: { mode: "1v1", room_id: roomId },
  });
  if (error) throw error;
  return data;
}

export function submitDominoOneVsOneMove(
  roomId: string,
  tile: DominoTileData,
  branch?: KozelBranch,
) {
  return submitCommand("submit_one_vs_one", {
    action: "move",
    room_id: roomId,
    tile,
    branch,
  });
}

export function submitDominoOneVsOnePass(
  roomId: string,
  timedOut = false,
  claim?: DominoOneVsOneTurnTimeoutClaim,
) {
  return submitCommand("submit_one_vs_one", {
    action: "pass",
    room_id: roomId,
    timed_out: timedOut,
    ...(claim ? {
      expected_version: claim.expectedVersion,
      expected_turn_started_at: claim.expectedTurnStartedAt,
      expected_turn_player_id: claim.expectedTurnPlayerId,
    } : {}),
  });
}

export function submitDominoOneVsOneDraw(
  roomId: string,
  timedOut = false,
  claim?: DominoOneVsOneDrawTimeoutClaim,
) {
  return submitCommand("submit_one_vs_one", {
    action: "draw",
    room_id: roomId,
    timed_out: timedOut,
    ...(claim ? {
      expected_version: claim.expectedVersion,
      expected_draw_started_at: claim.expectedDrawStartedAt,
      expected_turn_player_id: claim.expectedTurnPlayerId,
    } : {}),
  });
}
