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

function hasPlayable(playerIndex: number, hands: any[][], state: any) {
  return canHandMove(
    hands[playerIndex] ?? [],
    state.board,
    state.spinnerValue ?? null,
    state.isOpeningRound ?? state.isFirstRound ?? true,
    typeof state.openingDouble === "number" ? state.openingDouble : null,
  );
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
    const { room_id, timed_out: timedOut = false } = await req.json();
    if (!room_id) return json({ error: "Missing room_id" }, 400);

    const { data: room, error: roomErr } = await svc
      .from("one_vs_one_rooms")
      .select("id, status, state, version, current_turn_player_id, updated_at")
      .eq("id", room_id)
      .maybeSingle();

    if (roomErr) throw roomErr;
    if (!room) return json({ error: "1v1 room not found" }, 404);
    if (room.status !== "active")
      return json({ error: "1v1 room is not active" }, 400);

    const state = room.state || {};
    if (state.winningTeamId || state.roundWinnerPlayerId)
      return json({ error: "Round is not passable" }, 400);

    const { data: players, error: playersErr } = await svc
      .from("one_vs_one_players")
      .select("id, user_id, player_index, seat, team_id, kind")
      .eq("room_id", room_id)
      .order("player_index", { ascending: true });

    if (playersErr) throw playersErr;
    if (!Array.isArray(players) || players.length !== 2)
      return json({ error: "1v1 requires exactly 2 players" }, 400);

    const requestPlayerIndex = players.findIndex(
      (player: any) => player.user_id === user.id,
    );
    if (requestPlayerIndex === -1)
      return json({ error: "You are not a player in this 1v1 room" }, 403);

    const currentTurnPlayerId = state.currentTurnPlayerId ?? null;
    const playerIndex = players.findIndex(
      (player: any) => player.user_id === currentTurnPlayerId,
    );
    if (playerIndex === -1)
      return json({ error: "Active player is missing" }, 409);
    if (timedOut) {
      const turnStartedAt = Date.parse(
        state.turnStartedAt ?? room.updated_at ?? "",
      );
      if (
        !Number.isFinite(turnStartedAt) ||
        Date.now() - turnStartedAt < TURN_DURATION_MS
      ) {
        return json({ error: "Turn timer has not expired" }, 409);
      }
    } else if (currentTurnPlayerId !== user.id) {
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

    if (!timedOut && !state.board?.centerTile)
      return json({ error: "Cannot pass before opening move" }, 400);

    const { data: privateState, error: privateErr } = await svc
      .from("one_vs_one_private_states")
      .select("hands, boneyard")
      .eq("room_id", room_id)
      .maybeSingle();

    if (privateErr) throw privateErr;

    if (!privateState)
      return json({ error: "1v1 private state is missing" }, 409);

    const hands = Array.isArray(privateState.hands) ? privateState.hands : [];
    const boneyard = Array.isArray(privateState.boneyard)
      ? privateState.boneyard
      : [];
    const currentTurnDrawCount = Number(state.currentTurnDrawCount ?? 0);

    if (!timedOut && hasPlayable(playerIndex, hands, state))
      return json({ error: "You have a playable tile" }, 400);
    if (
      !timedOut &&
      boneyard.length > 0 &&
      currentTurnDrawCount < MAX_ONE_VS_ONE_DRAWS_PER_TURN
    ) {
      return json({ error: "You must draw before passing" }, 400);
    }

    const nextPlayerIndex = (playerIndex + 1) % 2;
    const nextPlayerId = players[nextPlayerIndex]?.user_id ?? null;
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

    let nextState = {
      ...state,
      mode: "1v1",
      currentTurnPlayerId: nextPlayerId,
      canDrawTile: false,
      currentTurnDrawCount: 0,
      lastPassedPlayerId: currentTurnPlayerId,
      turnStartedAt: new Date().toISOString(),
      lastScoringEvent: null,
      endOfHandScoringEvent: null,
      blockedPasses,
    };

    const opponentCannotPlay = !hasPlayable(nextPlayerIndex, hands, state);

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
        // The last player who placed a tile is king; scoring remains based on
        // the lowest-pip hand calculated above.
        leaderPlayerId: blockerPlayerId,
        endOfHandScoringEvent,
        winningTeamId: finished.winningTeamId,
        matchReward: finished.matchReward,
      };

      if (finished.winningTeamId) {
        nextTurnPlayerId = winner.user_id;
        nextStatus = "finished";
        nextState.currentTurnPlayerId = nextTurnPlayerId;
      } else {
        nextTurnPlayerId = blockerPlayerId;
        nextState.currentTurnPlayerId = nextTurnPlayerId;
      }
    } else {
      nextState.canDrawTile = nextPlayerId
        ? !hasPlayable(nextPlayerIndex, hands, state)
        : false;
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
      if (commitError.message?.includes("STALE_GAME_STATE"))
        return json({ error: "Stale 1v1 state, please retry" }, 409);
      throw commitError;
    }

    if (nextState.roundWinnerPlayerId && nextStatus !== "finished") {
      const { error: forfeitErr } = await svc.rpc(
        "resolve_one_vs_one_round_leave_forfeits",
        {
          p_room_id: room_id,
        },
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
        },
        room: updatedRoom,
      },
      200,
    );
  } catch (err) {
    console.error("submit_one_vs_one action=pass error", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
}
