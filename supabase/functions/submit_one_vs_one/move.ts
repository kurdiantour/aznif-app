
import { describeDominoOneVsOneServerError } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-server-error.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runDominoOneVsOnePostCommitLifecycle } from "../../../domino/modes/one-vs-one/lifecycle/domino-one-vs-one-post-commit-lifecycle.ts";
import { buildOneVsOneMoveCommit } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-commit-contract.ts";
import { commitMultiplayerAction, multiplayerConflictResponse } from "../../../lib/multiplayer/core/authoritative-commit.ts";

import { authenticateDominoOneVsOneRequest, loadDominoOneVsOnePlayers, loadDominoOneVsOnePrivateState, loadDominoOneVsOneRoom, projectDominoOneVsOnePrivateState } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-server-context.ts";

import {
  shouldOfferDraw,
} from "../../../domino/modes/one-vs-one/engine/domino-one-vs-one-engine.ts";
import { reduceOneVsOnePlay } from "../../../domino/modes/one-vs-one/authoritative/domino-one-vs-one-command-reducer.ts";
import {
  applyMove,
  canHandMove,
  createEmptyBoard,
  isValidMove,
} from "../_shared/kozel-engine.ts";
import {
  isBoardEmpty,
  isSameTile,
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
  if (!nextTurnPlayerId) return false;

  const nextIndex = players.findIndex(
    (player: any) => player.user_id === nextTurnPlayerId,
  );
  if (nextIndex < 0) return false;

  const ruleArgs = [
    state.board,
    state.spinnerValue ?? null,
    state.isOpeningRound ?? state.isFirstRound ?? true,
    typeof state.openingDouble === "number" ? state.openingDouble : null,
  ] as const;

  return shouldOfferDraw({
    boardStarted: Boolean(state.board?.centerTile),
    roundFinished: Boolean(state.roundWinnerPlayerId),
    matchFinished: Boolean(state.winningTeamId),
    handHasPlayableTile: canHandMove(hands[nextIndex] ?? [], ...ruleArgs),
    boneyardHasPlayableTile: canHandMove(boneyard, ...ruleArgs),
    boneyardCount: boneyard.length,
  });
}

export default async function handler(req: Request) {
  try {
    if (req.method !== "POST")
      return json({ error: "Method Not Allowed" }, 405);

    const auth = await authenticateDominoOneVsOneRequest(req, svc);
    if (!auth.ok) return auth.response;
    const user = auth.user;
    const { room_id, tile, branch } = await req.json();
    if (!room_id || !tile?.id)
      return json({ error: "Missing parameters" }, 400);

    const { data: room, error: roomErr } = await loadDominoOneVsOneRoom(svc, room_id);

    if (roomErr) throw roomErr;
    if (!room) return json({ error: "1v1 room not found" }, 404);
    if (room.status !== "active")
      return json({ error: "1v1 room is not active" }, 400);

    const state = room.state || {};
    if (state.winningTeamId)
      return json({ error: "1v1 match is already finished" }, 400);
    if (state.roundWinnerPlayerId)
      return json({ error: "Round is already complete" }, 400);

    const { data: players, error: playersErr } = await loadDominoOneVsOnePlayers(svc, room_id);

    if (playersErr) throw playersErr;
    if (!Array.isArray(players) || players.length !== 2)
      return json({ error: "1v1 requires exactly 2 players" }, 400);

    const playerIndex = players.findIndex(
      (player: any) => player.user_id === user.id,
    );
    if (playerIndex === -1)
      return json({ error: "You are not a player in this 1v1 room" }, 403);

    const { data: privateState, error: privateErr } = await loadDominoOneVsOnePrivateState(svc, room_id);

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

    const transition = reduceOneVsOnePlay({
      state,
      hands,
      boneyard,
      players,
      playerIndex,
      actorUserId: user.id,
      tile,
      branch,
      nextBoard,
      nextSpinnerValue,
      moveScore,
      phaseStartedAt: new Date().toISOString(),
      isSameTile,
      canNextPlayerDraw: (playerId, nextHands, nextState) => currentCanDraw(
        playerId,
        players,
        nextHands,
        boneyard,
        nextState,
      ),
      isHandPlayable: (targetPlayerIndex, nextHands, nextState) => {
        const ruleArgs = [
          nextState.board,
          nextState.spinnerValue ?? null,
          nextState.isOpeningRound ?? nextState.isFirstRound ?? true,
          typeof nextState.openingDouble === "number"
            ? nextState.openingDouble
            : null,
        ] as const;
        return canHandMove(nextHands[targetPlayerIndex] ?? [], ...ruleArgs);
      },
      isBoneyardPlayable: (nextState) => {
        const ruleArgs = [
          nextState.board,
          nextState.spinnerValue ?? null,
          nextState.isOpeningRound ?? nextState.isFirstRound ?? true,
          typeof nextState.openingDouble === "number"
            ? nextState.openingDouble
            : null,
        ] as const;
        return canHandMove(boneyard, ...ruleArgs);
      },
    });
    const {
      nextState,
      nextHands: finalHands,
      nextBoneyard: finalBoneyard,
      nextTurnPlayerId,
      status: nextStatus,
    } = transition;
    const roundWinnerPlayerId = nextState.roundWinnerPlayerId ?? null;
    const winningTeamId = nextState.winningTeamId ?? null;

    const commit = await commitMultiplayerAction(svc, buildOneVsOneMoveCommit({ roomId: room_id, expectedVersion: room.version, state: nextState, hands: finalHands, boneyard: finalBoneyard, currentTurnPlayerId: nextTurnPlayerId, status: nextStatus, playerId: user.id, tile, branch: branch ?? null, moveScore, wasOpeningMove: isOpeningRound && boardEmpty }));
    const updatedRoom = commit.ok ? commit.data : null;
    const commitError = commit.ok ? null : commit.error;
    if (commitError) {
      if (commitError.message?.includes("STALE_GAME_STATE"))
        return multiplayerConflictResponse("Stale 1v1 state, please retry");
      throw commitError;
    }


    await runDominoOneVsOnePostCommitLifecycle({ client: svc, action: "move", roomId: room_id, state: nextState, status: nextStatus, actingUserId: user.id, nextUserId: nextTurnPlayerId });

    return json(
      {
        ok: true,
        state: {
          ...projectDominoOneVsOnePrivateState({ state: nextState, hands: finalHands, playerIndex, revealFinalHands: true }),
        },
        room: updatedRoom,
      },
      200,
    );
  } catch (err) {
    const failure = describeDominoOneVsOneServerError(err);
    console.error("submit_one_vs_one action=move error", failure);
    return json({ error: failure.message, failure }, 500);
  }
}
