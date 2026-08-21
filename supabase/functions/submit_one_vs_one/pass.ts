
import { describeDominoOneVsOneServerError } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-server-error.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runDominoOneVsOnePostCommitLifecycle } from "../../../domino/modes/one-vs-one/lifecycle/domino-one-vs-one-post-commit-lifecycle.ts";
import { buildOneVsOnePassCommit } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-commit-contract.ts";
import { reconcileDominoOneVsOneCommit } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-timeout-conflict.ts";
import { commitMultiplayerAction } from "../../../lib/multiplayer/core/authoritative-commit.ts";

import { authenticateDominoOneVsOneRequest, loadDominoOneVsOnePlayers, loadDominoOneVsOnePrivateState, loadDominoOneVsOneRoom, projectDominoOneVsOnePrivateState } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-server-context.ts";

import { reduceOneVsOnePass } from "../../../domino/modes/one-vs-one/authoritative/domino-one-vs-one-command-reducer.ts";
import { canHandMove } from "../_shared/kozel-engine.ts";
import { DOMINO_HUMAN_TURN_DURATION_MS } from "../../../domino/shared/timing/domino-turn-timer.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const svc = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

const MAX_ONE_VS_ONE_DRAWS_PER_TURN = 3;
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
  return json(
    {
      ok: false,
      code,
      error: message,
      serverNow: new Date().toISOString(),
      roomVersion: Number(room?.version ?? -1),
      turnStartedAt: room?.state?.turnStartedAt ?? room?.updated_at ?? null,
      currentTurnPlayerId: room?.state?.currentTurnPlayerId ?? null,
      ...extra,
    },
    409,
  );
}

function hasPlayable(playerIndex: number, hands: any[][], state: any) {
  return canHandMove(
    hands[playerIndex] ?? [],
    state.board,
    state.spinnerValue ?? null,
    state.isOpeningRound ?? state.isFirstRound ?? true,
    typeof state.openingDouble === "number" ? state.openingDouble : null,
  );
}

function boneyardHasPlayable(boneyard: any[], state: any) {
  return canHandMove(
    boneyard,
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

    const auth = await authenticateDominoOneVsOneRequest(req, svc);
    if (!auth.ok) return auth.response;
    const user = auth.user;
    const {
      room_id,
      timed_out: timedOut = false,
      expected_version: expectedVersionRaw,
      expected_turn_started_at: expectedTurnStartedAt,
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
        expectedTurnPlayerId !== (state.currentTurnPlayerId ?? null)
      ) {
        return timeoutResponse(
          "stale_timeout",
          "Timeout claim does not match the active turn",
          room,
        );
      }
    }

    if (room.status !== "active") {
      return timedOut
        ? timeoutResponse("already_processed", "This turn is no longer active", room)
        : json({ error: "1v1 room is not active" }, 400);
    }

    if (state.winningTeamId || state.roundWinnerPlayerId) {
      return timedOut
        ? timeoutResponse("already_processed", "This turn is already complete", room)
        : json({ error: "Round is not passable" }, 400);
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
    const playerIndex = players.findIndex(
      (player: any) => player.user_id === currentTurnPlayerId,
    );

    if (playerIndex === -1) {
      return json({ error: "Active player is missing" }, 409);
    }

    if (!timedOut && currentTurnPlayerId !== user.id) {
      const details = {
        reason: "not_your_turn",
        room_id,
        requestUserId: user.id,
        roomCurrentTurnPlayerId: room.current_turn_player_id ?? null,
        stateCurrentTurnPlayerId: state.currentTurnPlayerId ?? null,
        effectiveCurrentTurnPlayerId: currentTurnPlayerId,
        playerIndex: requestPlayerIndex,
      };

      console.warn("submit_one_vs_one action=pass Not your turn", details);
      return json({ error: "Not your turn", details }, 403);
    }

    if (!timedOut && !state.board?.centerTile) {
      return json({ error: "Cannot pass before opening move" }, 400);
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
    const currentTurnDrawCount = Number(state.currentTurnDrawCount ?? 0);

    const mustDrawBeforePassing =
      !!state.board?.centerTile &&
      !hasPlayable(playerIndex, hands, state) &&
      boneyardHasPlayable(boneyard, state) &&
      currentTurnDrawCount < MAX_ONE_VS_ONE_DRAWS_PER_TURN;

    if (timedOut && mustDrawBeforePassing) {
      return timeoutResponse(
        "turn_timer_not_expired",
        "Turn timer is paused while the active player must draw",
        room,
        {
          timerPausedForDraw: true,
          expiresAt: null,
          retryAfterMs: null,
        },
      );
    }

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
    }

    if (!timedOut && hasPlayable(playerIndex, hands, state)) {
      return json({ error: "You have a playable tile" }, 400);
    }

    if (!timedOut && mustDrawBeforePassing) {
      return json({ error: "You must draw before passing" }, 400);
    }

    const nextPhaseStartedAt = new Date().toISOString();
    const transition = reduceOneVsOnePass({
      state,
      hands,
      boneyard,
      players,
      playerIndex,
      currentTurnPlayerId,
      timedOut,
      phaseStartedAt: nextPhaseStartedAt,
      isHandPlayable: (index, ruleState) => hasPlayable(index, hands, ruleState),
      isBoneyardPlayable: (ruleState) => boneyardHasPlayable(boneyard, ruleState),
    });
    const {
      nextState,
      nextTurnPlayerId,
      nextStatus,
      nextHands: finalHands,
      nextBoneyard: finalBoneyard,
    } = transition;

    const commit = await commitMultiplayerAction(svc, buildOneVsOnePassCommit({ roomId: room_id, expectedVersion: room.version, state: nextState, hands: finalHands, boneyard: finalBoneyard, currentTurnPlayerId: nextTurnPlayerId, status: nextStatus, playerId: currentTurnPlayerId, timedOut, blockedRoundResolved: Boolean(nextState.roundWinnerPlayerId) }));

    const reconciliation = await reconcileDominoOneVsOneCommit({
      client: svc,
      commit,
      timedOut,
      roomId: room_id,
      expectedVersion,
      originalRoom: room,
      alreadyProcessedMessage: "This turn timeout was already processed",
      staleMessage: "Timeout claim became stale before commit",
      timeoutResponse,
    });
    if (!reconciliation.ok) return reconciliation.response;
    const updatedRoom = reconciliation.updatedRoom;

    await runDominoOneVsOnePostCommitLifecycle({ client: svc, action: "pass", roomId: room_id, state: nextState, status: nextStatus, actingUserId: currentTurnPlayerId, nextUserId: nextTurnPlayerId, timedOut });

    return json(
      {
        ok: true,
        state: {
          ...projectDominoOneVsOnePrivateState({ state: nextState, hands: finalHands, playerIndex: requestPlayerIndex, userId: user.id, revealFinalHands: true }),
        },
        room: updatedRoom,
        serverNow: new Date().toISOString(),
      },
      200,
    );
  } catch (err) {
    const failure = describeDominoOneVsOneServerError(err);
    console.error("submit_one_vs_one action=pass error", failure);
    return json({ error: failure.message, failure }, 500);
  }
}