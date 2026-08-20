
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runDominoOneVsOnePostCommitLifecycle } from "../../../domino/modes/one-vs-one/lifecycle/domino-one-vs-one-post-commit-lifecycle.ts";
import { buildOneVsOneDrawCommit } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-commit-contract.ts";
import { reconcileDominoOneVsOneCommit } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-timeout-conflict.ts";
import { commitMultiplayerAction } from "../../../lib/multiplayer/core/authoritative-commit.ts";

import { authenticateDominoOneVsOneRequest, loadDominoOneVsOnePlayers, loadDominoOneVsOnePrivateState, loadDominoOneVsOneRoom, projectDominoOneVsOnePrivateState } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-server-context.ts";

import {
  canDrawOneVsOne,
} from "../../../domino/modes/one-vs-one/engine/domino-one-vs-one-engine.ts";
import { reduceOneVsOneDraw } from "../../../domino/modes/one-vs-one/authoritative/domino-one-vs-one-command-reducer.ts";

import { canHandMove } from "../_shared/kozel-engine.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const svc = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

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
  return canDrawOneVsOne({
    boardStarted: Boolean(state.board?.centerTile),
    roundFinished: Boolean(state.roundWinnerPlayerId),
    matchFinished: Boolean(state.winningTeamId),
    handHasPlayableTile: canHandMove(
      hands[playerIndex] ?? [],
      state.board,
      state.spinnerValue ?? null,
      state.isOpeningRound ?? state.isFirstRound ?? true,
      typeof state.openingDouble === "number" ? state.openingDouble : null,
    ),
    boneyardCount: boneyard.length,
    currentTurnDrawCount: Number(state.currentTurnDrawCount ?? 0),
  });
}

export default async function handler(req: Request) {
  try {
    if (req.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405);
    }

    const auth = await authenticateDominoOneVsOneRequest(req, svc);
    if (!auth.ok) return auth.response;
    const user = auth.user;
    const {
      room_id,
      timed_out: timedOut = false,
      expected_version: expectedVersionRaw,
      expected_draw_started_at: expectedDrawStartedAt,
      expected_turn_player_id: expectedTurnPlayerId,
    } = await req.json();

    if (!room_id) return json({ error: "Missing room_id" }, 400);

    const { data: room, error: roomErr } = await loadDominoOneVsOneRoom(svc, room_id);

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

    const { data: players, error: playersErr } = await loadDominoOneVsOnePlayers(svc, room_id);

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

    const { data: privateState, error: privateErr } = await loadDominoOneVsOnePrivateState(svc, room_id);

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

    const opponent = players.find(
      (player: any) => player.user_id !== currentTurnPlayerId,
    );
    const opponentPlayerId = opponent?.user_id ?? currentTurnPlayerId;
    const phaseStartedAt = new Date().toISOString();

    const transition = reduceOneVsOneDraw({
      state,
      hands,
      boneyard,
      activePlayerIndex,
      currentTurnPlayerId,
      opponentPlayerId,
      phaseStartedAt,
      hasPlayableTileAfterDraw: (nextHand) => canHandMove(
        nextHand,
        state.board,
        state.spinnerValue ?? null,
        state.isOpeningRound ?? state.isFirstRound ?? true,
        typeof state.openingDouble === "number" ? state.openingDouble : null,
      ),
    });

    const {
      nextState,
      nextHands,
      nextBoneyard,
      nextTurnDrawCount,
      finalTurnPlayerId,
      shouldAutoPass,
    } = transition;

    const action = timedOut
      ? shouldAutoPass
        ? "auto_draw_tile_auto_pass"
        : "auto_draw_tile"
      : shouldAutoPass
        ? "draw_tile_auto_pass"
        : "draw_tile";

    const commit = await commitMultiplayerAction(svc, buildOneVsOneDrawCommit({ roomId: room_id, expectedVersion: room.version, state: nextState, hands: nextHands, boneyard: nextBoneyard, currentTurnPlayerId: finalTurnPlayerId, status: null, playerId: currentTurnPlayerId, action, currentTurnDrawCount: nextTurnDrawCount, timedOut, autoPassed: shouldAutoPass, triggeredByUserId: user.id }));

    const reconciliation = await reconcileDominoOneVsOneCommit({
      client: svc,
      commit,
      timedOut,
      roomId: room_id,
      expectedVersion,
      originalRoom: room,
      alreadyProcessedMessage: "This draw phase was already processed",
      staleMessage: "Auto-draw claim became stale before commit",
      timeoutResponse,
    });
    if (!reconciliation.ok) return reconciliation.response;
    const updatedRoom = reconciliation.updatedRoom;

    await runDominoOneVsOnePostCommitLifecycle({ client: svc, action: "draw", roomId: room_id, state: nextState, status: null, actingUserId: currentTurnPlayerId, nextUserId: finalTurnPlayerId, timedOut, autoPassed: shouldAutoPass });

    return json(
      {
        ok: true,
        state: {
          ...projectDominoOneVsOnePrivateState({ state: nextState, hands: nextHands, playerIndex: requestPlayerIndex, userId: user.id }),
        },
        room: updatedRoom,
        serverNow: new Date().toISOString(),
      },
      200,
    );
  } catch (err) {
    console.error("submit_one_vs_one action=draw error", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}