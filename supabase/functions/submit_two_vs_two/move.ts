// @ts-nocheck

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  getNextHandKingIndex,
  NEXT_HAND_OPENING_STATE,
} from "../../../lib/game/king-rules.ts";
import { getNextClockwisePlayer } from "../../../lib/game/turn-order.ts";
import {
  applyMove,
  canAnyPlayerMove,
  createEmptyBoard,
  isValidMove,
} from "../_shared/kozel-engine.ts";
import { resolveMatchOutcome } from "../../../lib/game/match-rules.ts";
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
const svc = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeTile(left: number, right: number) {
  return { id: `${left}-${right}`, left, right, imageKey: `${left}-${right}` };
}

function dealHands() {
  const tiles = [];
  for (let left = 0; left <= 6; left += 1) {
    for (let right = left; right <= 6; right += 1) {
      tiles.push(makeTile(left, right));
    }
  }
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return {
    hands: [
      tiles.slice(0, 7),
      tiles.slice(7, 14),
      tiles.slice(14, 21),
      tiles.slice(21, 28),
    ],
    boneyard: [],
  };
}

function scoreOpponentPips(
  hands: any[][],
  players: any[],
  winnerTeamId: string,
) {
  return hands.reduce((sum, hand, index) => {
    if (players[index]?.team_id === winnerTeamId) return sum;
    return sum + pipTotal(hand ?? []);
  }, 0);
}

function startNextHand(
  state: any,
  leaderPlayerId: string | null,
  players: any[],
) {
  const { hands, boneyard } = dealHands();
  const leaderIndex = getNextHandKingIndex(players, leaderPlayerId);
  const currentTurnPlayerId =
    players[leaderIndex]?.user_id ?? players[0]?.user_id ?? null;
  return {
    hands,
    boneyard,
    publicState: {
      ...state,
      board: createEmptyBoard(),
      spinnerValue: null,
      handCounts: handCounts(hands),
      boneyardCount: 0,
      currentTurnPlayerId,
      leaderPlayerId: currentTurnPlayerId,
      ...NEXT_HAND_OPENING_STATE,
      roundWinnerPlayerId: null,
      lastPlayedTile: null,
      lastPassedPlayerId: null,
      blockedPasses: [],
      canDrawTile: false,
      roundEndReason: null,
    },
  };
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

    const { room_id, tile, branch } = await req.json();
    if (!room_id || !tile?.id)
      return json({ error: "Missing parameters" }, 400);

    const user = userData.user;
    const { data: room, error: roomErr } = await svc
      .from("two_vs_two_rooms")
      .select("id, status, state, version, current_turn_player_id")
      .eq("id", room_id)
      .maybeSingle();

    if (roomErr) throw roomErr;
    if (!room) return json({ error: "2v2 room not found" }, 404);
    if (room.status !== "active")
      return json({ error: "2v2 room is not active" }, 400);

    const state = room.state || {};
    if (state.winningTeamId)
      return json({ error: "2v2 match is already finished" }, 400);

    const { data: players, error: playersErr } = await svc
      .from("two_vs_two_players")
      .select("id, user_id, player_index, seat, team_id, kind")
      .eq("room_id", room_id)
      .order("player_index", { ascending: true });

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

    const { data: privateState, error: privateErr } = await svc
      .from("two_vs_two_private_states")
      .select("hands, boneyard")
      .eq("room_id", room_id)
      .maybeSingle();

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
    const nextHands = hands.map((hand, index) => {
      if (index !== playerIndex) return hand;
      let removed = false;
      return hand.filter((handTile) => {
        if (!removed && isSameTile(handTile, tile)) {
          removed = true;
          return false;
        }
        return true;
      });
    });

    const currentPlayer = players[playerIndex];
    const nextScores = {
      teamA: Number(state.teamScores?.teamA ?? 0),
      teamB: Number(state.teamScores?.teamB ?? 0),
    };
    let lastScoringEvent = null;
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

    let nextTurnPlayerId =
      getNextClockwisePlayer(players, players[playerIndex])?.user_id ?? null;
    let finalHands = nextHands;
    let finalBoneyard = [];
    let nextStatus = "active";
    let nextState = {
      ...state,
      mode: "2v2",
      board: nextBoard,
      spinnerValue: nextSpinnerValue,
      handCounts: handCounts(nextHands),
      boneyardCount: 0,
      currentTurnPlayerId: nextTurnPlayerId,
      turnStartedAt: new Date().toISOString(),
      isOpeningRound: false,
      isFirstRound: false,
      openingDouble: null,
      openingTileId: null,
      lastPlayedTile: tile,
      lastMoveBranch: branch ?? null,
      lastScoringEvent,
      teamScores: nextScores,
      lastPassedPlayerId: null,
      blockedPasses: [],
      canDrawTile: false,
    };

    let roundWinnerPlayerId = null;
    if (nextHands[playerIndex]?.length === 0) {
      roundWinnerPlayerId = user.id;
      const opponentPips = scoreOpponentPips(
        nextHands,
        players,
        currentPlayer.team_id,
      );
      const endScore = roundToNearestFive(opponentPips);
      if (endScore > 0) {
        nextScores[currentPlayer.team_id] =
          Number(nextScores[currentPlayer.team_id] ?? 0) + endScore;
        lastScoringEvent = {
          playerId: user.id,
          teamId: currentPlayer.team_id,
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
        teamScores: nextScores,
        lastScoringEvent,
        roundWinnerPlayerId,
        roundEndReason: "empty_hand",
        leaderPlayerId: user.id,
        winningTeamId: finished.winningTeamId,
        matchReward: finished.matchReward,
      };
      nextTurnPlayerId = user.id;
      if (finished.winningTeamId) {
        nextStatus = "finished";
      }
    } else if (
      !canAnyPlayerMove(nextHands, nextBoard, nextSpinnerValue, false, null)
    ) {
      const lowest = players.reduce(
        (best, player, index) => {
          const total = pipTotal(nextHands[index] ?? []);
          return total < best.total ? { index, total } : best;
        },
        { index: 0, total: pipTotal(nextHands[0] ?? []) },
      );
      const winner = players[lowest.index];
      const opponentPips = scoreOpponentPips(
        nextHands,
        players,
        winner.team_id,
      );
      const blockScore = roundToNearestFive(opponentPips);
      if (blockScore > 0) {
        nextScores[winner.team_id] =
          Number(nextScores[winner.team_id] ?? 0) + blockScore;
        lastScoringEvent = {
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
        lastScoringEvent,
        roundWinnerPlayerId: winner.user_id,
        roundEndReason: "blocked",
        // The player whose tile closed the board is king next hand. Scoring
        // still belongs to the lowest-pip player/team above.
        leaderPlayerId: user.id,
        winningTeamId: finished.winningTeamId,
        matchReward: finished.matchReward,
      };
      nextTurnPlayerId = user.id;
      if (finished.winningTeamId) {
        nextStatus = "finished";
      }
    }

    const { data: updatedRoom, error: commitError } = await svc.rpc(
      "commit_multiplayer_action",
      {
        p_mode: "2v2",
        p_room_id: room_id,
        p_expected_version: room.version,
        p_state: nextState,
        p_hands: finalHands,
        p_boneyard: finalBoneyard,
        p_current_turn_player_id: nextTurnPlayerId,
        p_status: nextStatus,
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
        return json({ error: "Stale 2v2 state, please retry" }, 409);
      throw commitError;
    }

    if (roundWinnerPlayerId && nextStatus !== "finished") {
      const { error: forfeitErr } = await svc.rpc(
        "resolve_two_vs_two_round_leave_forfeits",
        {
          p_room_id: room_id,
        },
      );
      if (forfeitErr) throw forfeitErr;
    }

    return json(
      {
        ok: true,
        state: { ...nextState, myHand: finalHands[playerIndex] ?? [] },
        room: updatedRoom,
      },
      200,
    );
  } catch (err) {
    console.error("submit_two_vs_two action=move error", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
}
