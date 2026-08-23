// @ts-nocheck

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
import {
  getNextOkeyMatchTurnDeadline,
  projectOkeyMatchPublicState,
  settleAuthoritativeOkeyRound,
  type OkeyAuthoritativeMatchState,
} from "../../../okey/server/okey-authoritative.ts";
import { playBotTurn } from "../../../okey/engine/okey-bot-engine.ts";
import { processDominoOneVsOneBotTurn } from "../../../domino/modes/one-vs-one/bot/domino-one-vs-one-bot-controller.ts";
import { describeDominoOneVsOneServerError } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-server-error.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const BOT_WORKER_SECRET = Deno.env.get("BOT_WORKER_SECRET");
const OKEY_WORKER_SECRET = Deno.env.get("OKEY_WORKER_SECRET");

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
  players: any[],
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


type OkeyAuthoritativeBundle = {
  version: number | string;
  status: "playing" | "finished";
  turn_deadline_at: string | null;
  player_index: number;
  state: OkeyAuthoritativeMatchState;
  command_applied: boolean;
};

async function processOkeyBotTurn(
  matchId: string,
  requesterUserId: string,
  claimedVersion: number,
  claimedActorId: string,
) {
  try {
    const { data: bundleRaw, error: bundleError } = await svc
      .rpc("okey_get_authoritative_bundle", {
        p_match_id: matchId,
        p_user_id: requesterUserId,
        p_command_id: null,
      })
      .single();

    const bundle = bundleRaw as OkeyAuthoritativeBundle | null;
    if (bundleError || !bundle) {
      return { ok: true, processed: false, reason: "match_not_found_or_forbidden" };
    }
    if (bundle.status !== "playing") {
      return { ok: true, processed: false, reason: "match_not_playing" };
    }

    const originalState = bundle.state;
    if (originalState.matchFinished) {
      return { ok: true, processed: false, reason: "match_finished" };
    }

    const expectedVersion = Number(bundle.version);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      return { ok: true, processed: false, reason: "invalid_version" };
    }
    if (expectedVersion !== claimedVersion) {
      return { ok: true, processed: false, reason: "stale_bot_turn" };
    }

    const currentPlayerIndex = originalState.roundState.currentPlayerIndex;
    const currentPlayer = originalState.roundState.players[currentPlayerIndex];
    if (currentPlayer?.id !== claimedActorId) {
      return { ok: true, processed: false, reason: "stale_bot_turn" };
    }
    if (!currentPlayer.controlledByBot) {
      return { ok: true, processed: false, reason: "current_player_is_human" };
    }

    const actorUserId = currentPlayer.id;

    const nextState = settleAuthoritativeOkeyRound({
      ...originalState,
      roundState: playBotTurn(originalState.roundState, {
        difficulty: currentPlayer.botDifficulty ?? "normal",
      }),
    });

    const nextVersion = expectedVersion + 1;
    const deadline = getNextOkeyMatchTurnDeadline(nextState);

    const { data: commit, error: commitError } = await svc
      .rpc("okey_commit_authoritative_command", {
        p_match_id: matchId,
        p_user_id: actorUserId,
        p_command_id: await deterministicCommandId(
          `okey:${matchId}:system-bot-turn:${expectedVersion}`,
        ),
        p_expected_version: expectedVersion,
        p_command_type: "system-bot-turn",
        p_state: nextState,
        p_projection: projectOkeyMatchPublicState(
          nextState,
          nextVersion,
          deadline,
        ),
        p_status: nextState.matchFinished ? "finished" : "playing",
        p_turn_deadline_at: deadline,
      })
      .single();

    if (commitError || !commit) {
      if (commitError?.message?.includes("version_conflict")) {
        return { ok: true, processed: false, reason: "stale_bot_controller" };
      }
      throw new Error(commitError?.message ?? "okey_bot_commit_failed");
    }
    if ((commit as { applied?: boolean }).applied === false) {
      return { ok: true, processed: false, reason: "already_processed" };
    }

    const committedVersion = Number((commit as { version: number }).version);

    try {
      const channel = svc.channel(`okey-match:${matchId}`);
      await channel.send({
        type: "broadcast",
        event: "state_update",
        payload: {
          matchId,
          version: committedVersion,
        },
      });
      await svc.removeChannel(channel);
    } catch (broadcastError) {
      console.error(`Okey bot broadcast failed for ${matchId}`, broadcastError);
    }

    if (nextState.matchFinished) {
      const winnerTeamId = nextState.matchWinnerTeamId;
      if (!winnerTeamId && nextState.leaveTerminationReason !== "no-humans") {
        throw new Error("finished_match_missing_winner_team");
      }

      const { error: settlementError } = await svc.rpc("okey_settle_match", {
        p_match_id: matchId,
        p_winner_team_id: winnerTeamId,
      });
      if (settlementError) {
        throw new Error(`okey_bot_settlement_failed: ${settlementError.message}`);
      }
    }

    return { ok: true, processed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`process_bot_turns Okey failed for ${matchId}`, error);
    return { ok: false, processed: false, error: message };
  }
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
      expected_actor_id,
    } = await req.json();
    if (mode !== "1v1" && mode !== "2v2" && mode !== "okey")
      return json({ error: "Invalid mode" }, 400);

    const workerSecret = req.headers.get("x-bot-worker-secret");
    const okeyWorkerSecret = req.headers.get("x-okey-worker-key");
    const isTrustedWorker = Boolean(
      (BOT_WORKER_SECRET && workerSecret === BOT_WORKER_SECRET) ||
        (mode === "okey" &&
          OKEY_WORKER_SECRET &&
          okeyWorkerSecret === OKEY_WORKER_SECRET),
    );

    if (mode === "okey") {
      if (!match_id) return json({ error: "Missing match_id" }, 400);
      if (
        !Number.isSafeInteger(expected_version) ||
        expected_version < 0 ||
        typeof expected_actor_id !== "string" ||
        expected_actor_id.length === 0
      ) {
        return json({ error: "Invalid Okey bot turn claim" }, 400);
      }

      let requesterUserId: string | null = null;

      if (isTrustedWorker) {
        const { data: seat, error: seatError } = await svc
          .schema("okey")
          .from("match_seats")
          .select("user_id")
          .eq("match_id", match_id)
          .order("player_index", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (seatError) throw seatError;
        requesterUserId = seat?.user_id ?? null;
      } else {
        const token = (req.headers.get("authorization") || "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!token) return json({ error: "Unauthorized" }, 401);

        const { data: userData, error: userError } = await svc.auth.getUser(token);
        if (userError || !userData.user) {
          return json({ error: "Invalid auth token" }, 401);
        }
        requesterUserId = userData.user.id;
      }

      if (!requesterUserId) {
        return json({ ok: true, processed: false, reason: "match_has_no_seats" });
      }

      return json(await processOkeyBotTurn(
        match_id,
        requesterUserId,
        expected_version,
        expected_actor_id,
      ));
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
        (player: any) => player.user_id === currentTurnPlayerId,
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
    let payload: any = { reason: "bot_takeover" };

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


