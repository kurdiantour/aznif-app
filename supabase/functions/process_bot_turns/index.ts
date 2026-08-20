// @ts-nocheck

import { createClient } from "jsr:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  applyMove,
  canAnyPlayerMove,
  canHandMove,
  createEmptyBoard,
  getPlayableBranches,
} from "../_shared/kozel-engine.ts";
import { resolveMatchOutcome } from "../../../lib/game/match-rules.ts";
import { getNextOkeyOrderPlayer } from "../../../lib/game/turn-order.ts";
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


const OKEY_MATCH_LIMIT = 100;

type OkeyMatchRow = {
  id: string;
  version: number | string;
  status: "playing" | "finished";
};

type OkeySeatRow = {
  user_id: string;
  player_index: number;
};

async function processOkeyBotTurns(matchId?: string | null) {
  let query = svc
    .schema("okey")
    .from("matches")
    .select("id, version, status")
    .eq("status", "playing")
    .order("updated_at", { ascending: true })
    .limit(OKEY_MATCH_LIMIT);

  if (matchId) {
    query = query.eq("id", matchId);
  }

  const { data: rawMatches, error: matchesError } = await query;
  if (matchesError) throw matchesError;

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const failures: Array<{ matchId: string; error: string }> = [];

  for (const match of (rawMatches ?? []) as OkeyMatchRow[]) {
    try {
      const [stateResult, seatsResult] = await Promise.all([
        svc
          .schema("okey")
          .from("match_private_states")
          .select("state")
          .eq("match_id", match.id)
          .single(),
        svc
          .schema("okey")
          .from("match_seats")
          .select("user_id, player_index")
          .eq("match_id", match.id),
      ]);

      if (stateResult.error || seatsResult.error || !stateResult.data) {
        skipped += 1;
        continue;
      }

      const seats = (seatsResult.data ?? []) as OkeySeatRow[];
      if (seats.length !== 4) {
        skipped += 1;
        continue;
      }

      const originalState = stateResult.data.state as OkeyAuthoritativeMatchState;
      if (originalState.matchFinished) {
        skipped += 1;
        continue;
      }

      const currentPlayerIndex = originalState.roundState.currentPlayerIndex;
      const currentPlayer = originalState.roundState.players[currentPlayerIndex];
      if (!currentPlayer?.controlledByBot) {
        skipped += 1;
        continue;
      }

      const actorSeat = seats.find(
        (seat) => seat.player_index === currentPlayerIndex,
      );
      if (!actorSeat?.user_id) {
        skipped += 1;
        continue;
      }

      const expectedVersion = Number(match.version);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        skipped += 1;
        continue;
      }

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
          p_match_id: match.id,
          p_user_id: actorSeat.user_id,
          p_command_id: crypto.randomUUID(),
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
          skipped += 1;
          continue;
        }
        throw new Error(commitError?.message ?? "okey_bot_commit_failed");
      }

      const committedVersion = Number((commit as { version: number }).version);

      try {
        const channel = svc.channel(`okey-match:${match.id}`);
        await channel.send({
          type: "broadcast",
          event: "state_update",
          payload: {
            matchId: match.id,
            version: committedVersion,
            status: nextState.matchFinished ? "finished" : "playing",
            projection: projectOkeyMatchPublicState(
              nextState,
              committedVersion,
              deadline,
            ),
          },
        });
        await svc.removeChannel(channel);
      } catch (broadcastError) {
        console.error(`Okey bot broadcast failed for ${match.id}`, broadcastError);
      }

      if (nextState.matchFinished) {
        const winnerTeamId = nextState.matchWinnerTeamId;
        if (!winnerTeamId && nextState.leaveTerminationReason !== "no-humans") {
          throw new Error("finished_match_missing_winner_team");
        }

        const { error: settlementError } = await svc.rpc("okey_settle_match", {
          p_match_id: match.id,
          p_winner_team_id: winnerTeamId,
        });
        if (settlementError) {
          throw new Error(`okey_bot_settlement_failed: ${settlementError.message}`);
        }
      }

      processed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ matchId: match.id, error: message });
      console.error(`process_bot_turns Okey failed for ${match.id}`, error);
    }
  }

  return {
    ok: true,
    mode: "okey",
    scanned: rawMatches?.length ?? 0,
    processed,
    skipped,
    failed,
    failures,
  };
}

serve(async (req) => {
  try {
    if (req.method !== "POST")
      return json({ error: "Method Not Allowed" }, 405);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "Server configuration is incomplete" }, 503);
    }

    const { mode = "1v1", room_id, match_id } = await req.json();
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
      if (!isTrustedWorker) return json({ error: "Unauthorized" }, 401);
      return json(await processOkeyBotTurns(match_id ?? null));
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
    const hand = hands[playerIndex] ?? [];
    const botMove = pickBotMove(hand, state);
    const nextPlayerId =
      getNextOkeyOrderPlayer(players, players[playerIndex])?.user_id ?? null;
    let nextHands = hands;
    let nextBoneyard = boneyard;
    let nextState = state;
    let action = "bot_pass_turn";
    let payload: any = { reason: "bot_takeover" };

    if (botMove) {
      const board = state.board ?? createEmptyBoard();
      const result = applyMove(
        board,
        botMove.tile,
        botMove.branch,
        state.spinnerValue ?? null,
        isOpeningRound(state),
      );

      nextHands = hands.map((playerHand: any[], index: number) => {
        if (index !== playerIndex) return playerHand;
        let removed = false;
        return playerHand.filter((tile: any) => {
          if (!removed && tile.id === botMove.tile.id) {
            removed = true;
            return false;
          }

          return true;
        });
      });

      nextState = {
        ...state,
        board: result.board,
        spinnerValue: result.spinnerValue,
        handCounts: handCounts(nextHands),
        boneyardCount: nextBoneyard.length,
        currentTurnPlayerId: nextPlayerId,
        isOpeningRound: false,
        isFirstRound: false,
        openingDouble: null,
        openingTileId: null,
        lastPlayedTile: botMove.tile,
        lastMoveBranch: botMove.branch,
        lastScoringEvent: null,
        endOfHandScoringEvent: null,
        lastPassedPlayerId: null,
        blockedPasses: [],
        canDrawTile: false,
      };

        const currentPlayer = players[playerIndex];
        const nextScores = {
          teamA: Number(state.teamScores?.teamA ?? 0),
          teamB: Number(state.teamScores?.teamB ?? 0),
        };
        let lastScoringEvent = null;
        let endOfHandScoringEvent = null;

        if (result.moveScore > 0) {
          nextScores[currentPlayer.team_id] += Number(result.moveScore);
          lastScoringEvent = {
            playerId: currentTurnPlayerId,
            teamId: currentPlayer.team_id,
            points: result.moveScore,
            openEndsTotal: result.moveScore,
          };
        }

        let roundWinner = null;
        let roundEndReason = null;
        let leaderPlayerId = state.leaderPlayerId ?? currentTurnPlayerId;

        if ((nextHands[playerIndex] ?? []).length === 0) {
          roundWinner = currentPlayer;
          roundEndReason = "empty_hand";
          leaderPlayerId = currentTurnPlayerId;
        } else if (
          !canAnyPlayerMove(
            nextHands,
            result.board,
            result.spinnerValue,
            false,
            null,
          )
        ) {
          const lowest = players.reduce(
            (best, candidate, index) => {
              const total = pipTotal(nextHands[index] ?? []);
              return total < best.total ? { player: candidate, total } : best;
            },
            { player: players[0], total: pipTotal(nextHands[0] ?? []) },
          );
          roundWinner = lowest.player;
          roundEndReason = "blocked";
          // The player whose tile closed the board remains king next hand.
          leaderPlayerId = currentTurnPlayerId;
        }

        if (roundWinner) {
          const opponentPips = scoreOpponentPips(
            nextHands,
            players,
            roundWinner.team_id,
          );
          const endScore = roundToNearestFive(opponentPips);
          if (endScore > 0) {
            nextScores[roundWinner.team_id] += endScore;
            endOfHandScoringEvent = {
              playerId: roundWinner.user_id,
              teamId: roundWinner.team_id,
              points: endScore,
              openEndsTotal: opponentPips,
            };
          }
          const finished = resolveMatchOutcome(
            nextScores,
            state.matchReward ?? null,
          );
          nextState = {
            ...nextState,
            currentTurnPlayerId: currentTurnPlayerId,
            leaderPlayerId,
            teamScores: nextScores,
            lastScoringEvent,
            endOfHandScoringEvent,
            roundWinnerPlayerId: roundWinner.user_id,
            roundEndReason,
            winningTeamId: finished.winningTeamId,
            matchReward: finished.matchReward,
          };
        } else {
          nextState = {
            ...nextState,
            teamScores: nextScores,
            lastScoringEvent,
          };
        }
      action = "bot_play_tile";
      payload = {
        tile: botMove.tile,
        branch: botMove.branch,
        reason: "bot_takeover",
      };
    } else {
      nextState = {
        ...state,
        currentTurnPlayerId: nextPlayerId,
        lastPassedPlayerId: currentTurnPlayerId,
        blockedPasses: Array.from(
          new Set([...(state.blockedPasses ?? []), currentTurnPlayerId]),
        ),
        canDrawTile: false,
      };
    }

    const { data: updatedRoom, error: commitError } = await svc.rpc("commit_multiplayer_action", {
      p_mode: mode,
      p_room_id: room_id,
      p_expected_version: room.version,
      p_state: nextState,
      p_hands: nextHands,
      p_boneyard: nextBoneyard,
      p_current_turn_player_id: nextState.currentTurnPlayerId ?? nextPlayerId,
      // Keep a completed 2v2 round active until the leave-forfeit resolver has
      // had the chance to override a normal score win.
      p_status: mode === "2v2" && nextState.roundWinnerPlayerId ? "active" : null,
      p_player_id: currentTurnPlayerId,
      p_action: action,
      p_payload: payload,
    });
    if (commitError) {
      if (commitError.message?.includes("STALE_GAME_STATE"))
        return json({ error: "Stale room state, please retry" }, 409);
      throw commitError;
    }

    if (nextState.roundWinnerPlayerId) {
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
        // The status update normally invokes domino_settle_finished_room.
        // Call the current idempotent authority as an explicit recovery path;
        // settle_finished_match_rewards is a legacy no-op compatibility stub.
        const { error: rewardErr } = await svc.rpc(
          "domino_settle_match",
          {
            p_mode: mode,
            p_room_id: room_id,
          },
        );
        if (rewardErr) throw rewardErr;
      }
    }


    return json({
      ok: true,
      processed: true,
      action,
      state: updatedRoom?.state ?? nextState,
    });
  } catch (err) {
    console.error("process_bot_turns error", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});

