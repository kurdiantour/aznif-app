// @ts-nocheck

import { createClient } from "jsr:@supabase/supabase-js@2";
import { canAnyPlayerMove, canHandMove } from "../_shared/kozel-engine.ts";
import { getNextOkeyOrderPlayer } from "../../../lib/game/turn-order.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const svc = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});
const TURN_DURATION_MS = 20_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function timeoutResponse(
  code: "turn_timer_not_expired" | "stale_timeout" | "already_processed",
  message: string,
  room: any,
  extra: Record<string, unknown> = {},
) {
  return json({
    ok: false,
    code,
    error: message,
    serverNow: new Date().toISOString(),
    roomVersion: Number(room?.version ?? -1),
    turnStartedAt: room?.state?.turnStartedAt ?? room?.updated_at ?? null,
    currentTurnPlayerId:
      room?.state?.currentTurnPlayerId ?? room?.current_turn_player_id ?? null,
    ...extra,
  }, 409);
}

export default async function handler(req: Request) {
  try {
    if (req.method !== "POST")
      return json({ error: "Method Not Allowed" }, 405);
    const token = (req.headers.get("authorization") || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const { data: userData, error: userError } = await svc.auth.getUser(token);
    if (userError || !userData?.user)
      return json({ error: "Invalid auth token" }, 401);

    const user = userData.user;
    const {
      room_id,
      timed_out: timedOut = false,
      expected_version: expectedVersionRaw,
      expected_turn_started_at: expectedTurnStartedAt,
      expected_turn_player_id: expectedTurnPlayerId,
    } = await req.json();
    if (!room_id) return json({ error: "Missing room_id" }, 400);

    const { data: room, error: roomErr } = await svc
      .from("two_vs_two_rooms")
      .select("id, status, state, version, current_turn_player_id, updated_at")
      .eq("id", room_id)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) return json({ error: "2v2 room not found" }, 404);

    const state = room.state || {};
    const expectedVersion = Number(expectedVersionRaw);
    if (timedOut) {
      if (
        !Number.isInteger(expectedVersion) ||
        typeof expectedTurnStartedAt !== "string" ||
        typeof expectedTurnPlayerId !== "string"
      ) {
        return timeoutResponse(
          "stale_timeout",
          "Timeout claim is missing its turn identity",
          room,
        );
      }
      if (expectedVersion !== Number(room.version)) {
        return timeoutResponse(
          expectedVersion < Number(room.version)
            ? "already_processed"
            : "stale_timeout",
          expectedVersion < Number(room.version)
            ? "This turn timeout was already processed"
            : "Timeout claim does not match the room version",
          room,
        );
      }
      if (
        expectedTurnStartedAt !== (state.turnStartedAt ?? room.updated_at ?? null) ||
        expectedTurnPlayerId !==
          (state.currentTurnPlayerId ?? room.current_turn_player_id ?? null)
      ) {
        return timeoutResponse(
          "stale_timeout",
          "Timeout claim does not match the active turn",
          room,
        );
      }
    }

    if (room.status !== "active")
      return timedOut
        ? timeoutResponse("already_processed", "This turn is no longer active", room)
        : json({ error: "2v2 room is not active" }, 400);

    if (!timedOut && !state.board?.centerTile)
      return json({ error: "Cannot pass before opening move" }, 400);
    if (state.winningTeamId)
      return timedOut
        ? timeoutResponse("already_processed", "This turn is already complete", room)
        : json({ error: "2v2 match is already finished" }, 400);

    const { data: players, error: playersErr } = await svc
      .from("two_vs_two_players")
      .select("id, user_id, player_index, seat, team_id, kind")
      .eq("room_id", room_id)
      .order("player_index", { ascending: true });
    if (playersErr) throw playersErr;
    if (!Array.isArray(players) || players.length !== 4)
      return json({ error: "2v2 requires exactly 4 players" }, 400);

    const requestPlayerIndex = players.findIndex(
      (player) => player.user_id === user.id,
    );
    if (requestPlayerIndex === -1)
      return json({ error: "You are not a player in this 2v2 room" }, 403);
    const currentTurnPlayerId =
      room.current_turn_player_id ?? state.currentTurnPlayerId;
    const playerIndex = players.findIndex(
      (player) => player.user_id === currentTurnPlayerId,
    );
    if (playerIndex === -1)
      return json({ error: "Active player is missing" }, 409);
    if (timedOut) {
      const turnStartedAt = Date.parse(
        state.turnStartedAt ?? room.updated_at ?? "",
      );
      const serverNowMs = Date.now();
      const expiresAtMs = turnStartedAt + TURN_DURATION_MS;
      if (!Number.isFinite(turnStartedAt) || serverNowMs < expiresAtMs) {
        return timeoutResponse(
          "turn_timer_not_expired",
          "Turn timer has not expired",
          room,
          {
            expiresAt: Number.isFinite(expiresAtMs)
              ? new Date(expiresAtMs).toISOString()
              : null,
            retryAfterMs: Number.isFinite(expiresAtMs)
              ? Math.max(0, expiresAtMs - serverNowMs)
              : null,
          },
        );
      }
    } else if (currentTurnPlayerId !== user.id)
      return json({ error: "Not your turn" }, 403);

    const { data: privateState, error: privateErr } = await svc
      .from("two_vs_two_private_states")
      .select("hands, boneyard")
      .eq("room_id", room_id)
      .maybeSingle();
    if (privateErr) throw privateErr;
    if (!privateState)
      return json({ error: "2v2 private state is missing" }, 409);

    const hands = Array.isArray(privateState.hands) ? privateState.hands : [];
    const hasPlayable = canHandMove(
      hands[playerIndex] ?? [],
      state.board,
      state.spinnerValue ?? null,
      state.isOpeningRound ?? state.isFirstRound ?? true,
      typeof state.openingDouble === "number" ? state.openingDouble : null,
    );
    if (!timedOut && hasPlayable)
      return json({ error: "You have a playable tile" }, 400);

    if (
      !timedOut &&
      !canAnyPlayerMove(
        hands,
        state.board,
        state.spinnerValue ?? null,
        state.isOpeningRound ?? state.isFirstRound ?? true,
        typeof state.openingDouble === "number" ? state.openingDouble : null,
      )
    ) {
      return json(
        { error: "Round is blocked; play resolution is handled after moves" },
        400,
      );
    }

    const nextPlayerId =
      getNextOkeyOrderPlayer(players, players[playerIndex])?.user_id ?? null;
    const nextState = {
      ...state,
      currentTurnPlayerId: nextPlayerId,
      lastPassedPlayerId: currentTurnPlayerId,
      turnStartedAt: new Date().toISOString(),
      canDrawTile: false,
      blockedPasses: Array.from(
        new Set([...(state.blockedPasses ?? []), currentTurnPlayerId]),
      ),
    };

    const { data: updatedRoom, error: commitError } = await svc.rpc(
      "commit_multiplayer_action",
      {
        p_mode: "2v2",
        p_room_id: room_id,
        p_expected_version: room.version,
        p_state: nextState,
        p_hands: hands,
        p_boneyard: privateState.boneyard ?? [],
        p_current_turn_player_id: nextPlayerId,
        p_status: null,
        p_player_id: currentTurnPlayerId,
        p_action: "pass_turn",
        p_payload: { nextPlayerId, timedOut },
      },
    );
    if (commitError) {
      if (commitError.message?.includes("STALE_GAME_STATE")) {
        if (timedOut) {
          const { data: latestRoom, error: latestRoomError } = await svc
            .from("two_vs_two_rooms")
            .select("id, status, state, version, current_turn_player_id, updated_at")
            .eq("id", room_id)
            .maybeSingle();
          if (latestRoomError) throw latestRoomError;
          if (latestRoom && Number(latestRoom.version) > expectedVersion) {
            return timeoutResponse(
              "already_processed",
              "This turn timeout was already processed",
              latestRoom,
            );
          }
          return timeoutResponse(
            "stale_timeout",
            "Timeout claim became stale before commit",
            latestRoom ?? room,
          );
        }
        return json({ error: "Stale 2v2 state, please retry" }, 409);
      }
      throw commitError;
    }

    return json(
      {
        ok: true,
        state: {
          ...nextState,
          myHand: hands[requestPlayerIndex] ?? [],
          myHandOwnerId: user.id,
        },
        room: updatedRoom,
        serverNow: new Date().toISOString(),
      },
      200,
    );
  } catch (err) {
    console.error("submit_two_vs_two action=pass error", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
}
