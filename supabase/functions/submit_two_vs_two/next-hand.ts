// @ts-nocheck

import {
  authenticateDominoTwoVsTwoRequest,
  loadDominoTwoVsTwoPrivateState,
  loadDominoTwoVsTwoPlayers,
  loadDominoTwoVsTwoRoom,
} from "../../../domino/modes/two-vs-two/server/domino-two-vs-two-server-context.ts";
import { buildTwoVsTwoCommit } from "../../../domino/modes/two-vs-two/server/domino-two-vs-two-commit-contract.ts";
import { getTwoVsTwoNextHandDisposition, startTwoVsTwoNextHand } from "../../../domino/modes/two-vs-two/lifecycle/domino-two-vs-two-round-transition.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const svc = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function completedRoundId(state: any) {
  return state?.lastCompletedRound?.id ?? null;
}

async function snapshotForPlayer(room: any, playerIndex: number) {
  const { data: privateState, error } =
    await loadDominoTwoVsTwoPrivateState(svc, room.id);
  if (error) throw error;
  const hands = Array.isArray(privateState?.hands) ? privateState.hands : [];
  return {
    ok: true,
    state: { ...(room.state ?? {}), myHand: hands[playerIndex] ?? [] },
    room,
  };
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const auth = await authenticateDominoTwoVsTwoRequest(req, svc);
    if ("response" in auth) return auth.response;

    const { room_id, expected_completed_round_id } = await req.json();
    if (!room_id || !expected_completed_round_id) {
      return json({ error: "Missing room_id or expected_completed_round_id" }, 400);
    }

    const [{ data: room, error: roomError }, { data: players, error: playersError }] =
      await Promise.all([
        loadDominoTwoVsTwoRoom(svc, room_id),
        loadDominoTwoVsTwoPlayers(svc, room_id),
      ]);
    if (roomError) throw roomError;
    if (playersError) throw playersError;
    if (!room) return json({ error: "2v2 room not found" }, 404);
    if (!Array.isArray(players) || players.length !== 4) {
      return json({ error: "2v2 requires exactly 4 players" }, 409);
    }

    const playerIndex = players.findIndex((player) => player.user_id === auth.user.id);
    if (playerIndex < 0) return json({ error: "Room membership required" }, 403);

    const state = room.state ?? {};
    const disposition = getTwoVsTwoNextHandDisposition(
      { ...state, status: room.status },
      expected_completed_round_id,
    );
    if (disposition === "stale") {
      return json({ error: "Stale completed 2v2 round" }, 409);
    }
    if (disposition === "already_started") {
      return json(await snapshotForPlayer(room, playerIndex));
    }
    if (disposition === "match_finished") {
      return json({ error: "2v2 match is already finished" }, 409);
    }

    const transition = startTwoVsTwoNextHand({
      state,
      players,
      startedAt: new Date().toISOString(),
      shuffleSeed: crypto.getRandomValues(new Uint32Array(1))[0],
    });
    const { data: updatedRoom, error: commitError } = await svc.rpc(
      "commit_multiplayer_action",
      buildTwoVsTwoCommit({
        roomId: room_id,
        expectedVersion: room.version,
        state: transition.nextState,
        hands: transition.nextHands,
        boneyard: transition.nextBoneyard,
        currentTurnPlayerId: transition.nextTurnPlayerId,
        status: transition.status,
        playerId: auth.user.id,
        action: "start_next_hand",
        payload: { completedRoundId: expected_completed_round_id },
      }),
    );

    if (commitError) {
      if (!commitError.message?.includes("STALE_GAME_STATE")) throw commitError;
      const { data: latestRoom, error: latestError } =
        await loadDominoTwoVsTwoRoom(svc, room_id);
      if (latestError) throw latestError;
      if (
        latestRoom &&
        completedRoundId(latestRoom.state) === expected_completed_round_id &&
        !latestRoom.state?.roundWinnerPlayerId
      ) {
        return json(await snapshotForPlayer(latestRoom, playerIndex));
      }
      return json({ error: "Stale completed 2v2 round" }, 409);
    }

    return json({
      ok: true,
      state: {
        ...(updatedRoom?.state ?? transition.nextState),
        myHand: transition.nextHands[playerIndex] ?? [],
      },
      room: updatedRoom,
    });
  } catch (error) {
    console.error("submit_two_vs_two action=start_next_hand error", error);
    return json({ error: error?.message ?? String(error) }, 500);
  }
}
