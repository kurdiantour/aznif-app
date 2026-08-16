// @ts-nocheck

import { createClient } from "jsr:@supabase/supabase-js@2";

import { resolveMatchOutcome } from "../../../lib/game/match-rules.ts";
import {
  applyMove,
  canHandMove,
  createEmptyBoard,
  isValidMove,
} from "../_shared/kozel-engine.ts";
import {
  handCounts,
  isBoardEmpty,
  isSameTile,
  pipTotal,
  roundToNearestFive,
} from "../_shared/game-utils.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

const svc = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function currentCanDraw(
  nextTurnPlayerId: string | null,
  players: any[],
  hands: any[][],
  boneyard: any[],
  state: any,
) {
  if (
    !nextTurnPlayerId ||
    !state.board?.centerTile ||
    state.roundWinnerPlayerId ||
    state.winningTeamId
  ) {
    return false;
  }

  const nextIndex = players.findIndex(
    (player: any) => player.user_id === nextTurnPlayerId,
  );
  if (nextIndex < 0) return false;

  if (boneyard.length === 0) return false;

  if (!canHandMove(
    boneyard,
    state.board,
    state.spinnerValue ?? null,
    state.isOpeningRound ?? state.isFirstRound ?? true,
    typeof state.openingDouble === "number" ? state.openingDouble : null,
  )) return false;

  return !canHandMove(
    hands[nextIndex] ?? [],
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
    const { room_id, tile, branch } = await req.json();
    if (!room_id || !tile?.id)
      return json({ error: "Missing parameters" }, 400);

    const { data: room, error: roomErr } = await svc
      .from("one_vs_one_rooms")
      .select("id, status, state, version, current_turn_player_id")
      .eq("id", room_id)
      .maybeSingle();

    if (roomErr) throw roomErr;
    if (!room) return json({ error: "1v1 room not found" }, 404);
    if (room.status !== "active")
      return json({ error: "1v1 room is not active" }, 400);

    const state = room.state || {};
    if (state.winningTeamId)
      return json({ error: "1v1 match is already finished" }, 400);
    if (state.roundWinnerPlayerId)
      return json({ error: "Round is already complete" }, 400);

    const { data: players, error: playersErr } = await svc
      .from("one_vs_one_players")
      .select("id, user_id, player_index, seat, team_id, kind")
      .eq("room_id", room_id)
      .order("player_index", { ascending: true });

    if (playersErr) throw playersErr;
    if (!Array.isArray(players) || players.length !== 2)
      return json({ error: "1v1 requires exactly 2 players" }, 400);

    const playerIndex = players.findIndex(
      (player: any) => player.user_id === user.id,
    );
    if (playerIndex === -1)
      return json({ error: "You are not a player in this 1v1 room" }, 403);

    const { data: privateState, error: privateErr } = await svc
      .from("one_vs_one_private_states")
      .select("hands, boneyard")
      .eq("room_id", room_id)
      .maybeSingle();

    if (privateErr) throw privateErr;

    const hands = Array.isArray(privateState?.hands) ? privateState.hands : [];
    const boneyard = Array.isArray(privateState?.boneyard)
      ? privateState.boneyard
      : [];
    const myHand = Array.isArray(hands[playerIndex]) ? hands[playerIndex] : [];

    const currentTurnPlayerId = state.currentTurnPlayerId ?? null;
    if (currentTurnPlayerId !== user.id) {
      const details = {
        reason: "not_your_turn",
        room_id,
        requestUserId: user.id,
        roomCurrentTurnPlayerId: room.current_turn_player_id ?? null,
        stateCurrentTurnPlayerId: state.currentTurnPlayerId ?? null,
        effectiveCurrentTurnPlayerId: currentTurnPlayerId,
        playerIndex,
        currentPlayerHandIds: myHand.map(
          (handTile: any) => handTile?.id ?? null,
        ),
        submittedTileId: tile.id,
        players: players.map((player: any) => ({
          user_id: player.user_id,
          player_index: player.player_index,
          seat: player.seat,
          team_id: player.team_id,
        })),
      };

      console.warn("submit_one_vs_one action=move Not your turn", details);

      return json({ error: "Not your turn", details }, 403);
    }

    if (!privateState)
      return json({ error: "1v1 private state is missing" }, 409);

    const tileIndexInHand = myHand.findIndex((handTile: any) =>
      isSameTile(handTile, tile),
    );
    if (tileIndexInHand === -1)
      return json({ error: "Tile not found in your hand" }, 400);

    const board = state.board ?? createEmptyBoard();
    const spinnerValue = state.spinnerValue ?? null;
    const isOpeningRound = state.isOpeningRound ?? state.isFirstRound ?? true;
    const openingDouble =
      typeof state.openingDouble === "number" ? state.openingDouble : null;
    const boardEmpty = isBoardEmpty(board);
    const isOpeningMove = isOpeningRound && boardEmpty;

    if (isOpeningMove && openingDouble !== null) {
      const requiredTileId = `${openingDouble}-${openingDouble}`;
      if (
        tile.id !== requiredTileId &&
        !(
          Number(tile.left) === openingDouble &&
          Number(tile.right) === openingDouble
        )
      ) {
        return json(
          {
            error: `Opening move must be ${requiredTileId}`,
            requiredTile: requiredTileId,
          },
          400,
        );
      }
    }

    if (
      !isValidMove(
        tile,
        board,
        branch,
        spinnerValue,
        isOpeningRound,
        openingDouble,
      )
    ) {
      return json({ error: "Invalid move" }, 400);
    }

    const {
      board: nextBoard,
      spinnerValue: nextSpinnerValue,
      moveScore,
    } = applyMove(board, tile, branch, spinnerValue, isOpeningRound);

    const nextHands = hands.map((hand: any[], index: number) => {
      if (index !== playerIndex) return hand;
      let removed = false;
      return hand.filter((handTile: any) => {
        if (!removed && isSameTile(handTile, tile)) {
          removed = true;
          return false;
        }
        return true;
      });
    });

    const nextPlayerIndex = (playerIndex + 1) % 2;
    const currentPlayer = players.find(
      (player: any) => player.player_index === playerIndex,
    );
    const nextPlayer = players.find(
      (player: any) => player.player_index === nextPlayerIndex,
    );

    if (!currentPlayer || !nextPlayer?.user_id) {
      return json({ error: "Invalid 1v1 player mapping" }, 409);
    }

    const nextPlayerId = nextPlayer.user_id;
    const nextScores = {
      teamA: Number(state.teamScores?.teamA ?? 0),
      teamB: Number(state.teamScores?.teamB ?? 0),
    };

    let lastScoringEvent = null;
    let endOfHandScoringEvent = null;
    if (moveScore > 0) {
      nextScores[currentPlayer.team_id] =
        Number(nextScores[currentPlayer.team_id] ?? 0) + Number(moveScore);
      lastScoringEvent = {
        playerId: user.id,
        teamId: currentPlayer.team_id,
        points: moveScore,
        openEndsTotal: moveScore,
      };
    }

    let nextTurnPlayerId = nextPlayerId;
    let roundWinnerPlayerId = null;
    let winningTeamId = null;
    let reward = null;
    const finalHands = nextHands;
    const finalBoneyard = boneyard;

    if (nextHands[playerIndex]?.length === 0) {
      roundWinnerPlayerId = user.id;
      nextTurnPlayerId = user.id;
      const opponentPips = pipTotal(nextHands[nextPlayerIndex] ?? []);
      const endOfHandScore = roundToNearestFive(opponentPips);

      if (endOfHandScore > 0) {
        nextScores[currentPlayer.team_id] =
          Number(nextScores[currentPlayer.team_id] ?? 0) + endOfHandScore;
        endOfHandScoringEvent = {
          playerId: user.id,
          teamId: currentPlayer.team_id,
          points: endOfHandScore,
          openEndsTotal: opponentPips,
        };
      }

      const finished = resolveMatchOutcome(
        nextScores,
        state.matchReward ?? null,
      );
      winningTeamId = finished.winningTeamId;
      reward = finished.matchReward;
    }

    const nextPhaseStartedAt = new Date().toISOString();

    let nextState = {
      ...state,
      mode: "1v1",
      board: nextBoard,
      spinnerValue: nextSpinnerValue,
      currentTurnDrawCount: 0,
      handCounts: handCounts(nextHands),
      boneyardCount: boneyard.length,
      currentTurnPlayerId: nextTurnPlayerId,
      turnStartedAt: nextPhaseStartedAt,
      drawStartedAt: null,
      leaderPlayerId: roundWinnerPlayerId ?? state.leaderPlayerId ?? user.id,
      isOpeningRound: false,
      isFirstRound: false,
      openingDouble: null,
      openingTileId: null,
      lastPlayedTile: tile,
      lastMovePlayerId: user.id,
      lastMoveBranch: branch ?? null,
      lastScoringEvent,
      endOfHandScoringEvent,
      endOfHandScoreApplied: Boolean(roundWinnerPlayerId),
      teamScores: nextScores,
      roundWinnerPlayerId,
      roundEndReason: roundWinnerPlayerId ? "empty_hand" : null,
      revealedFinalHands: roundWinnerPlayerId ? finalHands : null,
      winningTeamId,
      matchReward: reward,
      lastPassedPlayerId: null,
      blockedPasses: [],
      canDrawTile: false,
    };

    if (!roundWinnerPlayerId) {
      nextState.canDrawTile = currentCanDraw(
        nextTurnPlayerId,
        players,
        nextHands,
        boneyard,
        nextState,
      );
      nextState.drawStartedAt = nextState.canDrawTile
        ? nextPhaseStartedAt
        : null;
    }

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
        p_status: winningTeamId ? "finished" : "active",
        p_player_id: user.id,
        p_action: "play_tile",
        p_payload: {
          tile,
          branch: branch ?? null,
          moveScore,
          wasOpeningMove: isOpeningRound && boardEmpty,
        },
      },
    );
    if (commitError) {
      if (commitError.message?.includes("STALE_GAME_STATE"))
        return json({ error: "Stale 1v1 state, please retry" }, 409);
      throw commitError;
    }

    if (roundWinnerPlayerId && !winningTeamId) {
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
          myHand: finalHands[playerIndex] ?? [],
          revealedFinalHands: roundWinnerPlayerId ? finalHands : null,
        },
        room: updatedRoom,
      },
      200,
    );
  } catch (err) {
    console.error("submit_one_vs_one action=move error", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
}