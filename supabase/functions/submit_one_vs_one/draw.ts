// @ts-nocheck

import { createClient } from "jsr:@supabase/supabase-js@2";

import { canHandMove } from "../_shared/kozel-engine.ts";
import { handCounts } from "../_shared/game-utils.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const svc = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

const MAX_ONE_VS_ONE_DRAWS_PER_TURN = 3;
const DRAW_PHASE_DURATION_MS = 5_000;

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
  return json(
    {
      ok: false,
      code,
      error: message,
      serverNow: new Date().toISOString(),
      roomVersion: Number(room?.version ?? -1),
      drawStartedAt: room?.state?.drawStartedAt ?? null,
      currentTurnPlayerId: room?.state?.currentTurnPlayerId ?? null,
      ...extra,
    },
    409,
  );
}

function canDrawForPlayer(
  playerIndex: number,
  hands: any[][],
  boneyard: any[],
  state: any,
) {
  if (
    !state.board?.centerTile ||
    boneyard.length === 0 ||
    state.roundWinnerPlayerId ||
    state.winningTeamId
  ) {
    return false;
  }

  if (
    Number(state.currentTurnDrawCount ?? 0) >= MAX_ONE_VS_ONE_DRAWS_PER_TURN
  ) {
    return false;
  }

  return !canHandMove(
    hands[playerIndex] ?? [],
    state.board,
    state.spinnerValue ?? null,
    state.isOpeningRound ?? state.isFirstRound ?? true,
    typeof state.openingDouble === "number" ? state.openingDouble : null,
  );
}

export default async function handler(req: Request) {
  try {
    if (req.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405);
    }

    const token = (req.headers.get("authorization") || "")
      .replace(/^Bearer\s+/i, "")
      .trim();

    if (!token) return json({ error: "Unauthorized" }, 401);

    const { data: userData, error: userError } = await svc.auth.getUser(token);
    if (userError || !userData?.user) {
      return json({ error: "Invalid auth token" }, 401);
    }

    const user = userData.user;
    const {
      room_id,
      timed_out: timedOut = false,
      expected_version: expectedVersionRaw,
      expected_draw_started_at: expectedDrawStartedAt,
      expected_turn_player_id: expectedTurnPlayerId,
    } = await req.json();

    if (!room_id) return json({ error: "Missing room_id" }, 400);

    const { data: room, error: roomErr } = await svc
      .from("one_vs_one_rooms")
      .select("id, status, state, version, current_turn_player_id, updated_at")
      .eq("id", room_id)
      .maybeSingle();

    if (roomErr) throw roomErr;
    if (!room) return json({ error: "1v1 room not found" }, 404);

    const state = room.state || {};
    const expectedVersion = Number(expectedVersionRaw);

    if (timedOut) {
      if (
        !Number.isInteger(expectedVersion) ||
        typeof expectedDrawStartedAt !== "string" ||
        typeof expectedTurnPlayerId !== "string"
      ) {
        return timeoutResponse(
          "stale_timeout",
          "Auto-draw claim is missing its draw-phase identity",
          room,
        );
      }

      if (expectedVersion !== Number(room.version)) {
        return timeoutResponse(
          expectedVersion < Number(room.version)
            ? "already_processed"
            : "stale_timeout",
          expectedVersion < Number(room.version)
            ? "This draw phase was already processed"
            : "Auto-draw claim does not match the room version",
          room,
        );
      }

      if (
        expectedDrawStartedAt !== (state.drawStartedAt ?? null) ||
        expectedTurnPlayerId !== (state.currentTurnPlayerId ?? null)
      ) {
        return timeoutResponse(
          "stale_timeout",
          "Auto-draw claim does not match the active draw phase",
          room,
        );
      }
    }

    if (room.status !== "active") {
      return timedOut
        ? timeoutResponse("already_processed", "This draw phase is no longer active", room)
        : json({ error: "1v1 room is not active" }, 400);
    }

    if (state.winningTeamId || state.roundWinnerPlayerId) {
      return timedOut
        ? timeoutResponse("already_processed", "This draw phase is already complete", room)
        : json({ error: "Round is not drawable" }, 400);
    }

    const { data: players, error: playersErr } = await svc
      .from("one_vs_one_players")
      .select("id, user_id, player_index")
      .eq("room_id", room_id)
      .order("player_index", { ascending: true });

    if (playersErr) throw playersErr;
    if (!Array.isArray(players) || players.length !== 2) {
      return json({ error: "1v1 requires exactly 2 players" }, 400);
    }

    const requestPlayerIndex = players.findIndex(
      (player: any) => player.user_id === user.id,
    );
    if (requestPlayerIndex === -1) {
      return json({ error: "You are not a player in this 1v1 room" }, 403);
    }

    const currentTurnPlayerId = state.currentTurnPlayerId ?? null;
    const activePlayerIndex = players.findIndex(
      (player: any) => player.user_id === currentTurnPlayerId,
    );

    if (activePlayerIndex === -1) {
      return json({ error: "Active player is missing" }, 409);
    }

    if (!timedOut && currentTurnPlayerId !== user.id) {
      return json({ error: "Not your turn" }, 403);
    }

    const { data: privateState, error: privateErr } = await svc
      .from("one_vs_one_private_states")
      .select("hands, boneyard")
      .eq("room_id", room_id)
      .maybeSingle();

    if (privateErr) throw privateErr;
    if (!privateState) {
      return json({ error: "1v1 private state is missing" }, 409);
    }

    const hands = Array.isArray(privateState.hands) ? privateState.hands : [];
    const boneyard = Array.isArray(privateState.boneyard)
      ? privateState.boneyard
      : [];

    if (!canDrawForPlayer(activePlayerIndex, hands, boneyard, state)) {
      return timedOut
        ? timeoutResponse("already_processed", "Draw is no longer required", room)
        : json({ error: "Draw is not currently allowed" }, 400);
    }

    if (timedOut) {
      const drawStartedAt = Date.parse(state.drawStartedAt ?? "");
      const serverNowMs = Date.now();
      const expiresAtMs = drawStartedAt + DRAW_PHASE_DURATION_MS;

      if (!Number.isFinite(drawStartedAt) || serverNowMs < expiresAtMs) {
        return timeoutResponse(
          "turn_timer_not_expired",
          "Draw timer has not expired",
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
    }

    const drawnTile = boneyard[0];
    const nextBoneyard = boneyard.slice(1);
    const nextHands = hands.map((hand: any[], index: number) =>
      index === activePlayerIndex ? [...hand, drawnTile] : hand,
    );

    const stillHasPlayableTile = canHandMove(
      nextHands[activePlayerIndex] ?? [],
      state.board,
      state.spinnerValue ?? null,
      state.isOpeningRound ?? state.isFirstRound ?? true,
      typeof state.openingDouble === "number" ? state.openingDouble : null,
    );

    const currentTurnDrawCount = Number(state.currentTurnDrawCount ?? 0);
    const nextTurnDrawCount = currentTurnDrawCount + 1;

    const opponent = players.find(
      (player: any) => player.user_id !== currentTurnPlayerId,
    );
    const opponentPlayerId = opponent?.user_id ?? currentTurnPlayerId;

    const shouldAutoPass =
      !stillHasPlayableTile &&
      (nextTurnDrawCount >= MAX_ONE_VS_ONE_DRAWS_PER_TURN ||
        nextBoneyard.length === 0);

    const stillNeedsDraw =
      !shouldAutoPass && !stillHasPlayableTile && nextBoneyard.length > 0;

    const finalTurnPlayerId = shouldAutoPass
      ? opponentPlayerId
      : currentTurnPlayerId;

    const phaseStartedAt = new Date().toISOString();

    const nextState = {
      ...state,
      mode: "1v1",
      currentTurnPlayerId: finalTurnPlayerId,
      turnStartedAt:
        stillHasPlayableTile || shouldAutoPass
          ? phaseStartedAt
          : state.turnStartedAt ?? phaseStartedAt,
      drawStartedAt: stillNeedsDraw ? phaseStartedAt : null,
      handCounts: handCounts(nextHands),
      boneyardCount: nextBoneyard.length,
      canDrawTile: stillNeedsDraw,
      currentTurnDrawCount: shouldAutoPass ? 0 : nextTurnDrawCount,
      lastDrawnTile: null,
      lastPassedPlayerId: shouldAutoPass ? currentTurnPlayerId : null,
      blockedPasses: shouldAutoPass ? [currentTurnPlayerId] : [],
    };

    const action = timedOut
      ? shouldAutoPass
        ? "auto_draw_tile_auto_pass"
        : "auto_draw_tile"
      : shouldAutoPass
        ? "draw_tile_auto_pass"
        : "draw_tile";

    const { data: updatedRoom, error: commitError } = await svc.rpc(
      "commit_multiplayer_action",
      {
        p_mode: "1v1",
        p_room_id: room_id,
        p_expected_version: room.version,
        p_state: nextState,
        p_hands: nextHands,
        p_boneyard: nextBoneyard,
        p_current_turn_player_id: finalTurnPlayerId,
        p_status: null,
        p_player_id: currentTurnPlayerId,
        p_action: action,
        p_payload: {
          remainingBoneyard: nextBoneyard.length,
          currentTurnDrawCount: nextTurnDrawCount,
          autoDrawn: timedOut,
          autoPassed: shouldAutoPass,
          triggeredByUserId: user.id,
        },
      },
    );

    if (commitError) {
      if (commitError.message?.includes("STALE_GAME_STATE")) {
        if (timedOut) {
          const { data: latestRoom, error: latestRoomError } = await svc
            .from("one_vs_one_rooms")
            .select("id, status, state, version, current_turn_player_id, updated_at")
            .eq("id", room_id)
            .maybeSingle();

          if (latestRoomError) throw latestRoomError;

          if (latestRoom && Number(latestRoom.version) > expectedVersion) {
            return timeoutResponse(
              "already_processed",
              "This draw phase was already processed",
              latestRoom,
            );
          }

          return timeoutResponse(
            "stale_timeout",
            "Auto-draw claim became stale before commit",
            latestRoom ?? room,
          );
        }

        return json({ error: "Stale 1v1 state, please retry" }, 409);
      }

      throw commitError;
    }

    // ── Timeout-strike accounting (1v1 only) ────────────────────────────────
    // A manual draw is valid human activity and resets the player's strikes.
    // An automatic draw by itself does NOT count as a turn timeout because the
    // same player's turn is still alive. Only an auto-draw that also auto-passes
    // ends the inactive turn, so it counts as exactly one timeout strike.
    if (timedOut) {
      if (shouldAutoPass) {
        await svc.rpc("process_one_vs_one_turn_strikes", {
          p_room_id: room_id,
          p_acting_user_id: currentTurnPlayerId,
          p_next_user_id: finalTurnPlayerId,
          p_increment_acting: true,
        });
      }
    } else {
      await svc.rpc("process_one_vs_one_turn_strikes", {
        p_room_id: room_id,
        p_acting_user_id: currentTurnPlayerId,
        p_next_user_id: finalTurnPlayerId,
        p_increment_acting: false,
      });
    }

    return json(
      {
        ok: true,
        state: {
          ...nextState,
          myHand: nextHands[requestPlayerIndex] ?? [],
          myHandOwnerId: user.id,
        },
        room: updatedRoom,
        serverNow: new Date().toISOString(),
      },
      200,
    );
  } catch (err) {
    console.error("submit_one_vs_one action=draw error", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
}