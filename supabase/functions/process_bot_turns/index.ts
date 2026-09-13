// @ts-nocheck: This Supabase Edge Function depends on Deno and extension-based imports not fully covered by the project TypeScript configuration.
// Note: "domino_settle_match" is used in processDominoOneVsOneBotTurn

import { reduceTwoVsTwoBotPass, reduceTwoVsTwoPlay } from "../../../domino/modes/two-vs-two/authoritative/domino-two-vs-two-command-reducer.ts";
import { finalizeTwoVsTwoRound } from "../../../domino/modes/two-vs-two/lifecycle/domino-two-vs-two-round-transition.ts";
import { buildTwoVsTwoCommit } from "../../../domino/modes/two-vs-two/server/domino-two-vs-two-commit-contract.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { deterministicCommandId } from "../_shared/deterministic-command-id.ts";
import {
  applyMove,
  canAnyPlayerMove,
  canHandMove,
  createEmptyBoard,
  getPlayableBranches,
} from "../_shared/kozel-engine.ts";
import { resolveMatchOutcome } from "../../../domino/core/rules/match-rules.ts";
import { getNextOkeyOrderPlayer } from "../../../domino/core/rules/turn-order.ts";
import {
  handCounts,
  pipTotal,
  roundToNearestFive,
} from "../_shared/game-utils.ts";
import { reconcileAuthoritativeServerLifecycleWakeup } from "../../../okey/server/okey-server-reconciler.ts";
import { processDominoOneVsOneBotTurn } from "../../../domino/modes/one-vs-one/bot/domino-one-vs-one-bot-controller.ts";
import { describeDominoOneVsOneServerError } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-server-error.ts";
import { scheduleAznifGameLifecycle } from "../_shared/aznif-game-lifecycle.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const BOT_WORKER_SECRET = Deno.env.get("BOT_WORKER_SECRET");
const AZNIF_LIFECYCLE_SECRET = Deno.env.get("AZNIF_LIFECYCLE_SECRET");
const AZNIF_GAME_LIFECYCLE_URL = Deno.env.get("AZNIF_GAME_LIFECYCLE_URL");

const svc = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tableNames(mode: string) {
  if (mode === "2v2") {
    return {
      rooms: "two_vs_two_rooms",
      players: "two_vs_two_players",
      privateStates: "two_vs_two_private_states",
      moves: "two_vs_two_moves",
      nextSequence: "next_two_vs_two_move_sequence",
      resolveForfeits: "resolve_two_vs_two_round_leave_forfeits",
    };
  }

  return {
    rooms: "one_vs_one_rooms",
    players: "one_vs_one_players",
    privateStates: "one_vs_one_private_states",
    moves: "one_vs_one_moves",
    nextSequence: "next_one_vs_one_move_sequence",
    resolveForfeits: "resolve_one_vs_one_round_leave_forfeits",
  };
}

function isOpeningRound(state: any) {
  return state.isOpeningRound ?? state.isFirstRound ?? true;
}

function openingDouble(state: any) {
  return typeof state.openingDouble === "number" ? state.openingDouble : null;
}

function scoreOpponentPips(
  hands: any[][],
  players: Array<{ team_id?: string | null }>,
  winnerTeamId: string,
) {
  return hands.reduce((sum, playerHand, index) => {
    if (players[index]?.team_id === winnerTeamId) return sum;
    return sum + pipTotal(playerHand ?? []);
  }, 0);
}

function pickBotMove(hand: any[], state: any) {
  const board = state.board ?? createEmptyBoard();
  const spinnerValue = state.spinnerValue ?? null;
  const opening = isOpeningRound(state);
  const requiredDouble = openingDouble(state);

  for (const tile of hand) {
    const branches = getPlayableBranches(
      tile,
      board,
      spinnerValue,
      opening,
      requiredDouble,
    );
    if (branches.length) {
      return { tile, branch: branches[0] };
    }
  }

  return null;
}


serve(async (req) => {
  try {
    if (req.method !== "POST")
      return json({ error: "Method Not Allowed" }, 405);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "Server configuration is incomplete" }, 503);
    }

    const {
      mode = "1v1",
      room_id,
      match_id,
      expected_version,
      run_at,
      eligible_at,
      turn_deadline_at,
    } = await req.json();
    if (mode !== "1v1" && mode !== "2v2" && mode !== "okey")
      return json({ error: "Invalid mode" }, 400);

    const workerSecret = req.headers.get("x-bot-worker-secret");
    const aznifLifecycleSecret = req.headers.get("x-aznif-lifecycle-key");
    const isTrustedWorker = Boolean(
      (BOT_WORKER_SECRET && workerSecret === BOT_WORKER_SECRET) ||
        (mode === "okey" &&
          AZNIF_LIFECYCLE_SECRET &&
          aznifLifecycleSecret === AZNIF_LIFECYCLE_SECRET),
    );

    if (mode === "okey") {
      if (!isTrustedWorker) {
        return json({ error: "Unauthorized" }, 401);
      }
      if (!match_id) return json({ error: "Missing match_id" }, 400);
      if (!Number.isSafeInteger(expected_version) || expected_version < 0) {
        return json({ error: "Missing or invalid expected_version" }, 400);
      }

      const { data: seat, error: seatError } = await svc
        .schema("okey")
        .from("match_seats")
        .select("user_id")
        .eq("match_id", match_id)
        .is("membership_released_at", null)
        .order("player_index", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (seatError) throw seatError;

      const requesterUserId = seat?.user_id ?? null;

      if (!requesterUserId) {
        return json({
          ok: true,
          processed: false,
          reason: "match_has_no_seats",
        });
      }

      const lifecyclePromise = reconcileAuthoritativeServerLifecycleWakeup({
        client: svc,
        matchId: match_id,
        requesterUserId,
        deterministicCommandId,
        ...(Number.isSafeInteger(expected_version) && expected_version >= 0
          ? { initialVersion: Number(expected_version) }
          : {}),
        eligibleAt: typeof eligible_at === "string" ? eligible_at : null,
        runAt: typeof run_at === 'string' ? run_at : null,
        turnDeadlineAt:
          typeof turn_deadline_at === "string" ? turn_deadline_at : null,
        broadcastStateUpdate: async (payload: any) => {
          const channel = svc.channel(`okey-match:${match_id}`);
          await channel.send({
            type: "broadcast",
            event: "state_update",
            payload,
          });
          await svc.removeChannel(channel);
        },
        dispatchLifecycleWakeup: async (wakeup: any) => {
          if (!AZNIF_GAME_LIFECYCLE_URL || !AZNIF_LIFECYCLE_SECRET) return;
          await scheduleAznifGameLifecycle({
            schedulerUrl: AZNIF_GAME_LIFECYCLE_URL,
            lifecycleSecret: AZNIF_LIFECYCLE_SECRET,
            gameType: "okey",
            matchId: wakeup.matchId,
            expectedVersion: wakeup.version,
            runAt: wakeup.runAt,
          });
        },
      });

      // One wake-up performs one short official transition. Do not acknowledge
      // Cloudflare until that transition and the next alarm registration have
      // completed; a thrown error lets Durable Object alarms retry durably.
      const lifecycleResult = await lifecyclePromise;
      return json({ ok: true, mode: "okey-lifecycle", result: lifecycleResult });
    }

    if (!room_id) return json({ error: "Missing room_id" }, 400);

    const names = tableNames(mode);

    if (!isTrustedWorker) {
      const token = (req.headers.get("authorization") || "")
        .replace(/^Bearer\s+/i, "")
        .trim();
      if (!token) return json({ error: "Unauthorized" }, 401);

      const { data: userData, error: userError } =
        await svc.auth.getUser(token);
      if (userError || !userData.user)
        return json({ error: "Invalid auth token" }, 401);

      const { data: membership, error: membershipError } = await svc
        .from(names.players)
        .select("id")
        .eq("room_id", room_id)
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership) return json({ error: "Room membership required" }, 403);
    }

    const { data: room, error: roomErr } = await svc
      .from(names.rooms)
      .select("id, status, state, version, current_turn_player_id")
      .eq("id", room_id)
      .maybeSingle();

    if (roomErr) throw roomErr;
    if (!room) return json({ error: "Room not found" }, 404);
    if (room.status !== "active")
      return json({ ok: true, processed: false, reason: "room_not_active" });

    const state = room.state ?? {};
    const currentTurnPlayerId =
      mode === "1v1"
        ? (state.currentTurnPlayerId ?? null)
        : (room.current_turn_player_id ?? state.currentTurnPlayerId ?? null);
    if (
      !currentTurnPlayerId ||
      state.winningTeamId ||
      state.roundWinnerPlayerId
    ) {
      return json({ ok: true, processed: false, reason: "no_open_bot_turn" });
    }

    const { data: players, error: playersErr } = await svc
      .from(names.players)
      .select(
        "id, user_id, player_index, seat, team_id, bot_takeover, connected, abandoned",
      )
      .eq("room_id", room_id)
      .order("player_index", { ascending: true });

    if (playersErr) throw playersErr;

    const playerIndex =
      players?.findIndex(
        (player: { user_id?: string | null }) =>
          player.user_id === currentTurnPlayerId,
      ) ?? -1;
    const player = playerIndex >= 0 ? players[playerIndex] : null;

    if (mode === "1v1" && playerIndex === -1) {
      const details = {
        reason: "turn_player_not_found",
        room_id,
        authUserId: null,
        roomCurrentTurnPlayerId: room.current_turn_player_id ?? null,
        stateCurrentTurnPlayerId: state.currentTurnPlayerId ?? null,
        effectiveCurrentTurnPlayerId: currentTurnPlayerId,
        playerIndex,
      };

      console.warn("process_bot_turns 1v1 turn player not found", details);

      return json({
        ok: true,
        processed: false,
        reason: "turn_player_not_found",
        details,
      });
    }

    if (!player?.bot_takeover || player.connected || player.abandoned) {
      return json({
        ok: true,
        processed: false,
        reason: "current_player_is_human",
      });
    }

    const { data: privateState, error: privateErr } = await svc
      .from(names.privateStates)
      .select("hands, boneyard")
      .eq("room_id", room_id)
      .maybeSingle();

    if (privateErr) throw privateErr;
    if (!privateState) return json({ error: "Private state is missing" }, 409);

    const hands = Array.isArray(privateState.hands) ? privateState.hands : [];
    const boneyard = Array.isArray(privateState.boneyard)
      ? privateState.boneyard
      : [];
    if (mode === "1v1") {
      const result = await processDominoOneVsOneBotTurn({
        client: svc,
        room,
        state,
        hands,
        boneyard,
        players,
        playerIndex,
        currentTurnPlayerId,
        rules: {
          createEmptyBoard,
          getPlayableBranches,
          applyMove,
          canHandMove,
          resolveMatchOutcome,
        },
      });
      if (!result.ok) {
        return json({ error: "Stale room state, please retry" }, 409);
      }
      return json({
        ok: true,
        processed: true,
        action: result.action,
        state: result.state,
      });
    }
    const completedAt = new Date().toISOString();
    const hand = hands[playerIndex] ?? [];
    const botMove = pickBotMove(hand, state);
    let transition;
    let action = "bot_pass_turn";
    let payload: {
      reason: string;
      tile?: unknown;
      branch?: unknown;
    } = { reason: "bot_takeover" };

    if (botMove) {
      const board = state.board ?? createEmptyBoard();
      const move = applyMove(
        board,
        botMove.tile,
        botMove.branch,
        state.spinnerValue ?? null,
        isOpeningRound(state),
      );
      transition = reduceTwoVsTwoPlay({
        state,
        hands,
        boneyard,
        players,
        playerIndex,
        actorUserId: currentTurnPlayerId,
        tile: botMove.tile,
        branch: botMove.branch,
        nextBoard: move.board,
        nextSpinnerValue: move.spinnerValue,
        moveScore: move.moveScore,
        phaseStartedAt: completedAt,
        isSameTile: (candidate, submitted) => candidate.id === submitted.id,
        canAnyPlayerMove: (candidateHands, candidateBoard, candidateSpinner) =>
          canAnyPlayerMove(
            candidateHands,
            candidateBoard,
            candidateSpinner,
            false,
            null,
          ),
      });
      action = "bot_play_tile";
      payload = {
        tile: botMove.tile,
        branch: botMove.branch,
        reason: "bot_takeover",
      };
    } else {
      transition = reduceTwoVsTwoBotPass({
        state,
        hands,
        boneyard,
        players,
        playerIndex,
        currentTurnPlayerId,
      });
    }

    transition = finalizeTwoVsTwoRound({
      transition,

      roomId: room_id,
      committedVersion: Number(room.version) + 1,
      completedAt,

    });
    const {
      nextState,
      nextHands,
      nextBoneyard,
      nextTurnPlayerId: nextPlayerId,
    } = transition;
    const { data: updatedRoom, error: commitError } = await svc.rpc(
      "commit_multiplayer_action",
      buildTwoVsTwoCommit({
        roomId: room_id,
        expectedVersion: room.version,
        state: nextState,
        hands: nextHands,
        boneyard: nextBoneyard,
        currentTurnPlayerId: nextState.currentTurnPlayerId ?? nextPlayerId,
        status: nextState.roundWinnerPlayerId ? "active" : null,
        playerId: currentTurnPlayerId,
        action,
        payload,
      }),
    );
    if (commitError) {
      if (commitError.message?.includes("STALE_GAME_STATE"))
        return json({ ok: true, processed: false, reason: "stale_game_state" });
      throw commitError;
    }

    if (nextState.roundWinnerPlayerId) {
      await svc.from("two_vs_two_players").update({ consecutive_timeout_strikes: 0 }).eq("room_id", room_id);
      const { data: forfeit, error: forfeitErr } = await svc.rpc(
        names.resolveForfeits,
        { p_room_id: room_id },
      );
      if (forfeitErr) throw forfeitErr;

      if (!forfeit?.forfeit && nextState.winningTeamId) {
        const { error: finishErr } = await svc
          .from(names.rooms)
          .update({ status: "finished", current_turn_player_id: null })
          .eq("id", room_id);
        if (finishErr) throw finishErr;
      }
    }


    return json({
      ok: true,
      processed: true,
      action,
      state: updatedRoom?.state ?? nextState,
    });
  } catch (err) {
    const failure = describeDominoOneVsOneServerError(err);
    console.error("process_bot_turns error", failure);
    return json({ error: failure.message, failure }, 500);
  }
});

