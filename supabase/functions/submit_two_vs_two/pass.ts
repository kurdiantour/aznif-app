// @ts-nocheck

import { authenticateDominoTwoVsTwoRequest, loadDominoTwoVsTwoPrivateState, loadDominoTwoVsTwoPlayers, loadDominoTwoVsTwoRoom } from "../../../domino/modes/two-vs-two/server/domino-two-vs-two-server-context.ts";
import { buildTwoVsTwoCommit } from "../../../domino/modes/two-vs-two/server/domino-two-vs-two-commit-contract.ts";
import { reduceTwoVsTwoPass } from "../../../domino/modes/two-vs-two/authoritative/domino-two-vs-two-command-reducer.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { canAnyPlayerMove, canHandMove } from "../_shared/kozel-engine.ts";
import { getNextOkeyOrderPlayer } from "../../../domino/core/rules/turn-order.ts";
import { DOMINO_HUMAN_TURN_DURATION_MS } from "../../../domino/shared/timing/domino-turn-timer.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const svc = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});
const TURN_DURATION_MS = DOMINO_HUMAN_TURN_DURATION_MS;

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
    const auth = await authenticateDominoTwoVsTwoRequest(req, svc);
    if ("response" in auth) return auth.response;
    const user = auth.user;

const {
      room_id,
      timed_out: timedOut = false,
      expected_version: expectedVersionRaw,
      expected_turn_started_at: expectedTurnStartedAt,
      expected_turn_player_id: expectedTurnPlayerId,
    } = await req.json();
    if (!room_id) return json({ error: "Missing room_id" }, 400);
    const { data: room, error: roomErr } = await loadDominoTwoVsTwoRoom(svc, room_id);
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
    if (state.roundWinnerPlayerId && Date.now() < Date.parse(state.roundStartsAt ?? ""))
      return timedOut ? timeoutResponse("turn_timer_not_expired", "Next round has not started", room, { expiresAt: state.roundStartsAt }) : json({ error: "Next 2v2 round has not started" }, 409);
    if (state.winningTeamId)
      return timedOut
        ? timeoutResponse("already_processed", "This turn is already complete", room)
        : json({ error: "2v2 match is already finished" }, 400);
    const { data: players, error: playersErr } = await loadDominoTwoVsTwoPlayers(svc, room_id);
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
    const { data: privateState, error: privateErr } = await loadDominoTwoVsTwoPrivateState(svc, room_id);
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

    const transition = reduceTwoVsTwoPass({
      state,
      hands,
      boneyard: privateState.boneyard ?? [],
      players,
      playerIndex,
      currentTurnPlayerId,
      timedOut,
      phaseStartedAt: new Date().toISOString(),
    });
    const {
      nextState,
      nextTurnPlayerId: nextPlayerId,
    } = transition;
    const { data: updatedRoom, error: commitError } = await svc.rpc(
      "commit_multiplayer_action",
      buildTwoVsTwoCommit({
        roomId: room_id,
        expectedVersion: room.version,
        state: nextState,
        hands,
        boneyard: privateState.boneyard ?? [],
        currentTurnPlayerId: nextPlayerId,
        status: null,
        playerId: currentTurnPlayerId,
        action: "pass_turn",
        payload: { nextPlayerId, timedOut },
      }),
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

    if (!nextState.winningTeamId) {
      await svc.rpc("process_two_vs_two_turn_strikes", {
        p_room_id: room_id,
        p_acting_user_id: currentTurnPlayerId,
        p_next_user_id: nextPlayerId,
        p_increment_acting: Boolean(timedOut),
      });
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
