// @ts-nocheck

import { createClient } from "jsr:@supabase/supabase-js@2";
import { createEmptyBoard } from "../_shared/kozel-engine.ts";
import { handCounts } from "../_shared/game-utils.ts";
import {
  getNextHandKingIndex,
  NEXT_HAND_OPENING_STATE,
} from "../../../lib/game/king-rules.ts";

const svc = createClient(
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  { auth: { persistSession: false } },
);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function dealHands() {
  const tiles = [];
  for (let left = 0; left <= 6; left += 1) {
    for (let right = left; right <= 6; right += 1) {
      tiles.push({ id: `${left}-${right}`, left, right, imageKey: `${left}-${right}` });
    }
  }
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [tiles[index], tiles[swapIndex]] = [tiles[swapIndex], tiles[index]];
  }
  return [tiles.slice(0, 7), tiles.slice(7, 14), tiles.slice(14, 21), tiles.slice(21, 28)];
}

export default async function handler(req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);
    const { data: userData, error: userError } = await svc.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: "Invalid auth token" }, 401);

    const { room_id } = await req.json();
    if (!room_id) return json({ error: "Missing room_id" }, 400);
    const { data: room, error: roomError } = await svc
      .from("two_vs_two_rooms")
      .select("id, status, state, version")
      .eq("id", room_id)
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room || room.status !== "active") return json({ error: "2v2 room is not active" }, 400);

    const state = room.state || {};
    if (!state.roundWinnerPlayerId && !state.winningTeamId) {
      return json({ ok: true, alreadyStarted: true });
    }
    if (state.winningTeamId) {
      return json({ error: "No completed round is waiting to start" }, 400);
    }
    const { data: players, error: playersError } = await svc
      .from("two_vs_two_players")
      .select("user_id, player_index")
      .eq("room_id", room_id)
      .order("player_index", { ascending: true });
    if (playersError) throw playersError;
    if (!players?.some((player) => player.user_id === userData.user.id)) return json({ error: "You are not a player in this room" }, 403);

    // Resolve a whole-team manual leave before dealing. This also closes the
    // animation/countdown race where next_hand arrives just after round end.
    const { data: forfeit, error: forfeitError } = await svc.rpc(
      "resolve_two_vs_two_round_leave_forfeits",
      { p_room_id: room_id },
    );
    if (forfeitError) throw forfeitError;
    if (forfeit?.forfeit) {
      return json({ error: "Match finished because a team left" }, 409);
    }

    // Reset timeout-strike counters so the lock only covers the previous round.
    await svc
      .from("two_vs_two_players")
      .update({ consecutive_timeout_strikes: 0 })
      .eq("room_id", room_id);

    const hands = dealHands();
    const leaderIndex = getNextHandKingIndex(
      players,
      state.leaderPlayerId ?? state.roundWinnerPlayerId,
    );
    const leaderPlayerId = players[leaderIndex]?.user_id ?? players[0]?.user_id;
    const nextState = {
      ...state,
      board: createEmptyBoard(),
      spinnerValue: null,
      handCounts: handCounts(hands),
      boneyardCount: 0,
      currentTurnPlayerId: leaderPlayerId,
      leaderPlayerId,
      turnStartedAt: new Date().toISOString(),
      ...NEXT_HAND_OPENING_STATE,
      roundWinnerPlayerId: null,
      roundEndReason: null,
      lastPlayedTile: null,
      lastScoringEvent: null,
      endOfHandScoringEvent: null,
      lastPassedPlayerId: null,
      blockedPasses: [],
      canDrawTile: false,
    };
    const { data: updatedRoom, error: commitError } = await svc.rpc("commit_multiplayer_action", {
      p_mode: "2v2", p_room_id: room_id, p_expected_version: room.version,
      p_state: nextState, p_hands: hands, p_boneyard: [],
      p_current_turn_player_id: leaderPlayerId, p_status: "active",
      p_player_id: userData.user.id, p_action: "start_next_hand", p_payload: {},
    });
    if (commitError) {
      // Every client finishes the presentation at nearly the same moment.
      // One atomic commit wins; concurrent callers should observe that new
      // hand as success instead of surfacing three expected HTTP failures.
      const { data: latestRoom, error: latestRoomError } = await svc
        .from("two_vs_two_rooms")
        .select("state, version")
        .eq("id", room_id)
        .maybeSingle();
      if (
        !latestRoomError &&
        latestRoom &&
        Number(latestRoom.version) > Number(room.version) &&
        !latestRoom.state?.roundWinnerPlayerId &&
        !latestRoom.state?.winningTeamId
      ) {
        return json({ ok: true, alreadyStarted: true, room: latestRoom });
      }
      throw commitError;
    }
    return json({ ok: true, room: updatedRoom });
  } catch (error) {
    console.error("submit_two_vs_two action=next_hand error", error);
    return json({ error: error?.message ?? String(error) }, 500);
  }
}
