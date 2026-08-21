// @ts-nocheck

import { authenticateDominoTwoVsTwoRequest, loadDominoTwoVsTwoPrivateState, loadDominoTwoVsTwoPlayers, loadDominoTwoVsTwoRoom } from "../../../domino/modes/two-vs-two/server/domino-two-vs-two-server-context.ts";
import { buildTwoVsTwoCommit } from "../../../domino/modes/two-vs-two/server/domino-two-vs-two-commit-contract.ts";
import { reduceTwoVsTwoPlay } from "../../../domino/modes/two-vs-two/authoritative/domino-two-vs-two-command-reducer.ts";
import { finalizeTwoVsTwoRound } from "../../../domino/modes/two-vs-two/lifecycle/domino-two-vs-two-round-transition.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  applyMove,
  canAnyPlayerMove,
  createEmptyBoard,
  isValidMove,
} from "../_shared/kozel-engine.ts";
import { isBoardEmpty, isSameTile } from "../_shared/game-utils.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const svc = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  try {
    if (req.method !== "POST")
      return json({ error: "Method Not Allowed" }, 405);
    const auth = await authenticateDominoTwoVsTwoRequest(req, svc);
    if ("response" in auth) return auth.response;
    const user = auth.user;
    const { room_id, tile, branch = null } = await req.json();
    if (!room_id || !tile) return json({ error: "Missing room_id or tile" }, 400);
    const { data: room, error: roomErr } = await loadDominoTwoVsTwoRoom(svc, room_id);

    if (roomErr) throw roomErr;
    if (!room) return json({ error: "2v2 room not found" }, 404);
    if (room.status !== "active")
      return json({ error: "2v2 room is not active" }, 400);

    const state = room.state || {};
    if (state.winningTeamId)
      return json({ error: "2v2 match is already finished" }, 400);
    if (state.roundWinnerPlayerId && Date.now() < Date.parse(state.roundStartsAt ?? ""))
      return json({ error: "Next 2v2 round has not started" }, 409);
    const { data: players, error: playersErr } = await loadDominoTwoVsTwoPlayers(svc, room_id);

    if (playersErr) throw playersErr;
    if (!Array.isArray(players) || players.length !== 4)
      return json({ error: "2v2 requires exactly 4 players" }, 400);

    const playerIndex = players.findIndex(
      (player) => player.user_id === user.id,
    );
    if (playerIndex === -1)
      return json({ error: "You are not a player in this 2v2 room" }, 403);
    if ((room.current_turn_player_id ?? state.currentTurnPlayerId) !== user.id)
      return json({ error: "Not your turn" }, 403);
    const { data: privateState, error: privateErr } = await loadDominoTwoVsTwoPrivateState(svc, room_id);

    if (privateErr) throw privateErr;
    if (!privateState)
      return json({ error: "2v2 private state is missing" }, 409);

    const hands = Array.isArray(privateState.hands) ? privateState.hands : [];
    const myHand = Array.isArray(hands[playerIndex]) ? hands[playerIndex] : [];
    const tileIndex = myHand.findIndex((handTile) =>
      isSameTile(handTile, tile),
    );
    if (tileIndex === -1)
      return json({ error: "Tile not found in your hand" }, 400);

    const board = state.board ?? createEmptyBoard();
    const spinnerValue = state.spinnerValue ?? null;
    const isOpeningRound = state.isOpeningRound ?? state.isFirstRound ?? true;
    const openingDouble =
      typeof state.openingDouble === "number" ? state.openingDouble : null;
    const boardEmpty = isBoardEmpty(board);

    if (isOpeningRound && boardEmpty && openingDouble !== null) {
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
    const completedAt = new Date().toISOString();
    const baseTransition = reduceTwoVsTwoPlay({
      state,
      hands,
      boneyard: privateState.boneyard ?? [],
      players,
      playerIndex,
      actorUserId: user.id,
      tile,
      branch: branch ?? null,
      nextBoard,
      nextSpinnerValue,
      moveScore,
      phaseStartedAt: completedAt,
      isSameTile,
      canAnyPlayerMove: (candidateHands, candidateBoard, candidateSpinner) =>
        canAnyPlayerMove(candidateHands, candidateBoard, candidateSpinner, false, null),
    });
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const transition = finalizeTwoVsTwoRound({
      transition: baseTransition,
      players,
      roomId: room_id,
      committedVersion: Number(room.version) + 1,
      completedAt,
      shuffleSeed: seed,
    });
    const {
      nextState,
      nextHands: finalHands,
      nextBoneyard: finalBoneyard,
      nextTurnPlayerId,
      status: nextStatus,
    } = transition;
    const roundWinnerPlayerId = nextState.roundWinnerPlayerId ?? null;
    const { data: updatedRoom, error: commitError } = await svc.rpc(
      "commit_multiplayer_action",
      buildTwoVsTwoCommit({
        roomId: room_id,
        expectedVersion: room.version,
        state: nextState,
        hands: finalHands,
        boneyard: finalBoneyard,
        currentTurnPlayerId: nextTurnPlayerId,
        status: nextStatus,
        playerId: user.id,
        action: "play_tile",
        payload: {
          tile,
          branch: branch ?? null,
          moveScore,
          wasOpeningMove: isOpeningRound && boardEmpty,
        },
      }),
    );
    if (commitError) {
      if (commitError.message?.includes("STALE_GAME_STATE"))
        return json({ error: "Stale 2v2 state, please retry" }, 409);
      throw commitError;
    }

    if (!roundWinnerPlayerId && !nextState.winningTeamId) {
      await svc.rpc("process_two_vs_two_turn_strikes", {
        p_room_id: room_id,
        p_acting_user_id: user.id,
        p_next_user_id: nextTurnPlayerId,
        p_increment_acting: false,
      });
    } else if (roundWinnerPlayerId && !nextState.winningTeamId) {
      await svc.from("two_vs_two_players").update({ consecutive_timeout_strikes: 0 }).eq("room_id", room_id);
    }

    return json(
      {
        ok: true,
        state: {
          ...(updatedRoom?.state ?? nextState),
          myHand: finalHands[playerIndex] ?? [],
        },
        room: updatedRoom,
      },
      200,
    );
  } catch (err) {
    console.error("submit_two_vs_two action=move error", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
}
