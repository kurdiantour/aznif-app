// @ts-nocheck

import { createClient } from "jsr:@supabase/supabase-js@2";

import { resolveMatchOutcome } from "../../../lib/game/match-rules.ts";
import { canHandMove } from "../_shared/kozel-engine.ts";
import { pipTotal, roundToNearestFive } from "../_shared/game-utils.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const svc = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

const MAX_ONE_VS_ONE_DRAWS_PER_TURN = 3;
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
      expected_turn_started_at: expectedTurnStartedAt,
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

    const { data: players, error: playersErr } = await svc
      .from("one_vs_one_players")
      .select("id, user_id, player_index, seat, team_id, kind")
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

    const nextPlayerIndex = (playerIndex + 1) % 2;
    const nextPlayerId = players[nextPlayerIndex]?.user_id ?? null;

    // If the required opening-double player times out before the first tile is
    // played, waive the opening-double restriction for the rest of this round.
    // The next player may start the board with any otherwise valid tile.
    const openingTimeoutWaived =
      timedOut &&
      !state.board?.centerTile &&
      (state.isOpeningRound ?? state.isFirstRound ?? true);

    const turnRuleState = openingTimeoutWaived
      ? {
          ...state,
          isOpeningRound: false,
          isFirstRound: false,
          openingDouble: null,
          openingTileId: null,
        }
      : state;

    const blockedPasses = Array.from(
      new Set([...(state.blockedPasses ?? []), currentTurnPlayerId]),
    );

    let nextScores = {
      teamA: Number(state.teamScores?.teamA ?? 0),
      teamB: Number(state.teamScores?.teamB ?? 0),
    };

    const finalHands = hands;
    const finalBoneyard = boneyard;
    let nextTurnPlayerId = nextPlayerId;
    let nextStatus = "active";
    let endOfHandScoringEvent = null;
    const nextPhaseStartedAt = new Date().toISOString();

    let nextState = {
      ...turnRuleState,
      mode: "1v1",
      currentTurnPlayerId: nextPlayerId,
      canDrawTile: false,
      drawStartedAt: null,
      currentTurnDrawCount: 0,
      lastPassedPlayerId: currentTurnPlayerId,
      turnStartedAt: nextPhaseStartedAt,
      lastScoringEvent: null,
      endOfHandScoringEvent: null,
      blockedPasses,
    };

    const opponentCannotPlay = !hasPlayable(
      nextPlayerIndex,
      hands,
      turnRuleState,
    );

    if (blockedPasses.length >= 2 && opponentCannotPlay) {
      const winnerIndex =
        pipTotal(hands[0] ?? []) <= pipTotal(hands[1] ?? []) ? 0 : 1;
      const winner = players[winnerIndex];
      const blockerPlayerId = state.lastMovePlayerId ?? winner.user_id;
      const opponentPips = pipTotal(hands[(winnerIndex + 1) % 2] ?? []);
      const blockScore = roundToNearestFive(opponentPips);

      if (blockScore > 0) {
        nextScores[winner.team_id] =
          Number(nextScores[winner.team_id] ?? 0) + blockScore;
        endOfHandScoringEvent = {
          playerId: winner.user_id,
          teamId: winner.team_id,
          points: blockScore,
          openEndsTotal: opponentPips,
        };
      }

      const finished = resolveMatchOutcome(
        nextScores,
        state.matchReward ?? null,
      );

      nextState = {
        ...nextState,
        teamScores: nextScores,
        roundWinnerPlayerId: winner.user_id,
        leaderPlayerId: blockerPlayerId,
        endOfHandScoringEvent,
        roundEndReason: "blocked",
        revealedFinalHands: finalHands,
        winningTeamId: finished.winningTeamId,
        matchReward: finished.matchReward,
        endOfHandScoreApplied: true,
        drawStartedAt: null,
      };

      nextTurnPlayerId = blockerPlayerId;
      nextState.currentTurnPlayerId = nextTurnPlayerId;
      nextStatus = finished.winningTeamId ? "finished" : "active";
    } else {
      const nextPlayerMustDraw = nextPlayerId
        ? !hasPlayable(nextPlayerIndex, hands, turnRuleState) &&
          boneyardHasPlayable(boneyard, turnRuleState) &&
          boneyard.length > 0
        : false;

      nextState.canDrawTile = nextPlayerMustDraw;
      nextState.drawStartedAt = nextPlayerMustDraw ? nextPhaseStartedAt : null;
    }

    nextState = {
      ...nextState,
      currentTurnPlayerId: nextTurnPlayerId,
    };

    const { data: updatedRoom, error: commitError } = await svc.rpc(
      "commit_multiplayer_action",
      {
        p_mode: "1v1",
        p_room_id: room_id,
        p_expected_version: room.version,
        p_state: nextState,
        p_hands: finalHands,
        p_boneyard: finalBoneyard,
        p_current_turn_player_id: nextTurnPlayerId,
        p_status: nextStatus,
        p_player_id: currentTurnPlayerId,
        p_action: "pass_turn",
        p_payload: {
          nextPlayerId: nextTurnPlayerId,
          timedOut,
          blockedRoundResolved: Boolean(nextState.roundWinnerPlayerId),
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

        return json({ error: "Stale 1v1 state, please retry" }, 409);
      }

      throw commitError;
    }


    // ── Timeout-strike accounting (1v1 only) ────────────────────────────────
    // Runs only when the round is still ongoing (no winner yet).
    // • timedOut=true  → increment acting player's consecutive_timeout_strikes.
    // • timedOut=false → reset acting player's strikes (valid human pass).
    // After updating, the function checks whether the NEXT turn player has
    // accumulated ≥ 2 strikes and, if so, triggers bot takeover for them.
    if (!nextState.roundWinnerPlayerId && !nextState.winningTeamId) {
await svc.rpc('process_one_vs_one_turn_strikes', {
  p_room_id: room_id,
  p_acting_user_id: currentTurnPlayerId,
  p_next_user_id: nextTurnPlayerId,
  p_increment_acting: Boolean(timedOut),
});
    }

    if (nextState.roundWinnerPlayerId && nextStatus !== "finished") {

      const { error: forfeitErr } = await svc.rpc(
        "resolve_one_vs_one_round_leave_forfeits",
        { p_room_id: room_id },
      );
      if (forfeitErr) throw forfeitErr;
    }

    return json(
      {
        ok: true,
        state: {
          ...nextState,
          myHand: finalHands[requestPlayerIndex] ?? [],
          myHandOwnerId: user.id,
          revealedFinalHands: nextState.roundWinnerPlayerId ? finalHands : null,
        },
        room: updatedRoom,
        serverNow: new Date().toISOString(),
      },
      200,
    );
  } catch (err) {
    console.error("submit_one_vs_one action=pass error", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
}