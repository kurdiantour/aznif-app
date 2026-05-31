// @ts-nocheck

import { createClient } from '@supabase/supabase-js';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

import { applyMove, canHandMove, createEmptyBoard, isValidMove } from '../../../lib/game/kozel-engine';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('EXPO_PUBLIC_SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const MATCH_TARGET = 350;

const svc = createClient(SUPABASE_URL ?? '', SUPABASE_SERVICE_ROLE_KEY ?? '', {
  auth: { persistSession: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeTile(left: number, right: number) {
  const a = Math.min(left, right);
  const b = Math.max(left, right);
  return { id: `${a}-${b}`, left: a, right: b, imageKey: `${a}-${b}` };
}

function shuffledDominoes() {
  const tiles = [];
  for (let left = 0; left <= 6; left += 1) {
    for (let right = left; right <= 6; right += 1) {
      if (left === 0 && right === 0) continue;
      tiles.push(makeTile(left, right));
    }
  }

  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }

  return tiles;
}

function dealHands() {
  const tiles = shuffledDominoes();
  return {
    hands: [tiles.slice(0, 9), tiles.slice(9, 18)],
    boneyard: tiles.slice(18),
  };
}

function pipTotal(hand: any[]) {
  return hand.reduce((sum, tile) => sum + Number(tile.left ?? 0) + Number(tile.right ?? 0), 0);
}

function roundToNearestFive(value: number) {
  return Math.round(value / 5) * 5;
}

function matchReward(winnerScore: number, loserScore: number) {
  const diff = Math.max(0, winnerScore - loserScore);
  if (diff <= 50) return { tier: 'close', gold: 3, points: 10 };
  if (diff <= 150) return { tier: 'normal', gold: 6, points: 20 };
  return { tier: 'dominating', gold: 9, points: 30 };
}

function isSameTile(a: any, b: any) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  const aLeft = Number(a.left);
  const aRight = Number(a.right);
  const bLeft = Number(b.left);
  const bRight = Number(b.right);
  return (aLeft === bLeft && aRight === bRight) || (aLeft === bRight && aRight === bLeft);
}

function isBoardEmpty(board: any) {
  if (!board) return true;
  const branches = board.branches ?? {};
  return !board.centerTile && !Object.values(branches).some((branch: any) => Array.isArray(branch?.tiles) && branch.tiles.length > 0);
}

function handCounts(hands: any[][]) {
  return hands.map((hand) => hand.length);
}

function currentCanDraw(nextTurnPlayerId: string | null, players: any[], hands: any[][], boneyard: any[], state: any) {
  if (!nextTurnPlayerId || !state.board?.centerTile || state.roundWinnerPlayerId || state.winningTeamId) {
    return false;
  }

  const nextIndex = players.findIndex((player: any) => player.user_id === nextTurnPlayerId);
  if (nextIndex < 0) return false;

  return !canHandMove(
    hands[nextIndex] ?? [],
    state.board,
    state.spinnerValue ?? null,
    state.isOpeningRound ?? state.isFirstRound ?? true,
    typeof state.openingDouble === 'number' ? state.openingDouble : null,
  );
}

function applyMatchWinner(nextScores: any, state: any) {
  if (nextScores.teamA < MATCH_TARGET && nextScores.teamB < MATCH_TARGET) {
    return { winningTeamId: null, matchReward: null };
  }

  let winningTeamId = null;
  if (nextScores.teamA > nextScores.teamB) winningTeamId = 'teamA';
  if (nextScores.teamB > nextScores.teamA) winningTeamId = 'teamB';

  if (!winningTeamId) return { winningTeamId: null, matchReward: null };

  const winnerScore = Number(nextScores[winningTeamId] ?? 0);
  const loserScore = winningTeamId === 'teamA' ? Number(nextScores.teamB ?? 0) : Number(nextScores.teamA ?? 0);

  return { winningTeamId, matchReward: state.matchReward ?? matchReward(winnerScore, loserScore) };
}

function startNextHand(state: any, leaderPlayerId: string | null, players: any[]) {
  const { hands, boneyard } = dealHands();
  let openingDouble = null;
  let leaderIndex = Math.max(0, players.findIndex((player: any) => player.user_id === leaderPlayerId));

  for (let d = 6; d >= 0; d -= 1) {
    const index = hands.findIndex((hand) => hand.some((tile) => tile.left === d && tile.right === d));
    if (index >= 0) {
      openingDouble = d;
      leaderIndex = index;
      break;
    }
  }

  const currentTurnPlayerId = players[leaderIndex]?.user_id ?? players[0]?.user_id ?? null;

  return {
    hands,
    boneyard,
    publicState: {
      ...state,
      board: createEmptyBoard(),
      spinnerValue: null,
      handCounts: handCounts(hands),
      boneyardCount: boneyard.length,
      currentTurnPlayerId,
      leaderPlayerId: currentTurnPlayerId,
      openingDouble,
      openingTileId: openingDouble === null ? null : `${openingDouble}-${openingDouble}`,
      isOpeningRound: true,
      isFirstRound: true,
      roundWinnerPlayerId: null,
      lastPlayedTile: null,
      lastScoringEvent: null,
      canDrawTile: false,
      lastPassedPlayerId: null,
      blockedPasses: [],
    },
  };
}

serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const { data: userData, error: userError } = await svc.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: 'Invalid auth token' }, 401);

    const user = userData.user;
    const { room_id, tile, branch } = await req.json();
    if (!room_id || !tile?.id) return json({ error: 'Missing parameters' }, 400);

    const { data: room, error: roomErr } = await svc
      .from('one_vs_one_rooms')
      .select('id, status, state, version, current_turn_player_id')
      .eq('id', room_id)
      .maybeSingle();

    if (roomErr) throw roomErr;
    if (!room) return json({ error: '1v1 room not found' }, 404);
    if (room.status !== 'active') return json({ error: '1v1 room is not active' }, 400);

    const state = room.state || {};
    if (state.winningTeamId) return json({ error: '1v1 match is already finished' }, 400);
    if (state.roundWinnerPlayerId) return json({ error: 'Round is already complete' }, 400);

    const { data: players, error: playersErr } = await svc
      .from('one_vs_one_players')
      .select('id, user_id, player_index, seat, team_id, kind')
      .eq('room_id', room_id)
      .order('player_index', { ascending: true });

    if (playersErr) throw playersErr;
    if (!Array.isArray(players) || players.length !== 2) return json({ error: '1v1 requires exactly 2 players' }, 400);

    const playerIndex = players.findIndex((player: any) => player.user_id === user.id);
    if (playerIndex === -1) return json({ error: 'You are not a player in this 1v1 room' }, 403);

    const currentTurnPlayerId = room.current_turn_player_id ?? state.currentTurnPlayerId ?? null;
    if (currentTurnPlayerId !== user.id) return json({ error: 'Not your turn' }, 403);

    const { data: privateState, error: privateErr } = await svc
      .from('one_vs_one_private_states')
      .select('hands, boneyard')
      .eq('room_id', room_id)
      .maybeSingle();

    if (privateErr) throw privateErr;

    if (!privateState) return json({ error: '1v1 private state is missing' }, 409);

    const hands = Array.isArray(privateState.hands) ? privateState.hands : [];
    const boneyard = Array.isArray(privateState.boneyard) ? privateState.boneyard : [];
    const myHand = Array.isArray(hands[playerIndex]) ? hands[playerIndex] : [];

    const tileIndexInHand = myHand.findIndex((handTile: any) => isSameTile(handTile, tile));
    if (tileIndexInHand === -1) return json({ error: 'Tile not found in your hand' }, 400);

    const board = state.board ?? createEmptyBoard();
    const spinnerValue = state.spinnerValue ?? null;
    const isOpeningRound = state.isOpeningRound ?? state.isFirstRound ?? true;
    const openingDouble = typeof state.openingDouble === 'number' ? state.openingDouble : null;
    const boardEmpty = isBoardEmpty(board);

    if (isOpeningRound && boardEmpty && openingDouble !== null) {
      const requiredTileId = `${openingDouble}-${openingDouble}`;
      if (tile.id !== requiredTileId && !(Number(tile.left) === openingDouble && Number(tile.right) === openingDouble)) {
        return json({ error: `Opening move must be ${requiredTileId}`, requiredTile: requiredTileId }, 400);
      }
    }

    if (!isValidMove(tile, board, branch, spinnerValue, isOpeningRound, openingDouble)) {
      return json({ error: 'Invalid move' }, 400);
    }

    const { board: nextBoard, spinnerValue: nextSpinnerValue, moveScore } = applyMove(
      board,
      tile,
      branch,
      spinnerValue,
      isOpeningRound,
    );

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

    const currentPlayer = players[playerIndex];
    const nextPlayerId = players[(playerIndex + 1) % 2]?.user_id ?? null;
    const nextScores = {
      teamA: Number(state.teamScores?.teamA ?? 0),
      teamB: Number(state.teamScores?.teamB ?? 0),
    };

    let lastScoringEvent = null;
    if (moveScore > 0) {
      nextScores[currentPlayer.team_id] = Number(nextScores[currentPlayer.team_id] ?? 0) + Number(moveScore);
      lastScoringEvent = { playerId: user.id, teamId: currentPlayer.team_id, points: moveScore, openEndsTotal: moveScore };
    }

    let nextTurnPlayerId = nextPlayerId;
    let roundWinnerPlayerId = null;
    let winningTeamId = null;
    let reward = null;
    let finalHands = nextHands;
    let finalBoneyard = boneyard;

    if (nextHands[playerIndex]?.length === 0) {
      roundWinnerPlayerId = user.id;
      nextTurnPlayerId = user.id;
      const opponentIndex = (playerIndex + 1) % 2;
      const opponentPips = pipTotal(nextHands[opponentIndex] ?? []);
      const endOfHandScore = roundToNearestFive(opponentPips);

      if (endOfHandScore > 0) {
        nextScores[currentPlayer.team_id] = Number(nextScores[currentPlayer.team_id] ?? 0) + endOfHandScore;
        lastScoringEvent = { playerId: user.id, teamId: currentPlayer.team_id, points: endOfHandScore, openEndsTotal: opponentPips };
      }

      const matchEnd = applyMatchWinner(nextScores, state);
      winningTeamId = matchEnd.winningTeamId;
      reward = matchEnd.matchReward;
    }

    let nextState = {
      ...state,
      mode: '1v1',
      board: nextBoard,
      spinnerValue: nextSpinnerValue,
      handCounts: handCounts(nextHands),
      boneyardCount: boneyard.length,
      currentTurnPlayerId: nextTurnPlayerId,
      leaderPlayerId: roundWinnerPlayerId ?? state.leaderPlayerId ?? user.id,
      isOpeningRound: false,
      isFirstRound: false,
      openingDouble: null,
      openingTileId: null,
      lastPlayedTile: tile,
      lastMoveBranch: branch ?? null,
      lastScoringEvent,
      teamScores: nextScores,
      roundWinnerPlayerId,
      winningTeamId,
      matchReward: reward,
      lastPassedPlayerId: null,
      blockedPasses: [],
      canDrawTile: false,
    };

    if (roundWinnerPlayerId && !winningTeamId) {
      const nextHand = startNextHand(nextState, roundWinnerPlayerId, players);
      finalHands = nextHand.hands;
      finalBoneyard = nextHand.boneyard;
      nextState = {
        ...nextHand.publicState,
        previousRoundWinnerPlayerId: roundWinnerPlayerId,
        lastScoringEvent,
        teamScores: nextScores,
      };
      nextTurnPlayerId = nextHand.publicState.currentTurnPlayerId;
    } else {
      nextState.canDrawTile = currentCanDraw(nextTurnPlayerId, players, nextHands, boneyard, nextState);
    }

    const { data: updatedRoom, error: updateErr } = await svc
      .from('one_vs_one_rooms')
      .update({
        state: nextState,
        version: Number(room.version ?? 0) + 1,
        current_turn_player_id: nextTurnPlayerId,
        status: winningTeamId ? 'finished' : 'active',
      })
      .eq('id', room_id)
      .eq('version', room.version)
      .select()
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!updatedRoom) return json({ error: 'Stale 1v1 state, please retry' }, 409);

    const { error: privateUpdateErr } = await svc
      .from('one_vs_one_private_states')
      .upsert({ room_id, hands: finalHands, boneyard: finalBoneyard }, { onConflict: 'room_id' });

    if (privateUpdateErr) throw privateUpdateErr;

    const { data: sequence, error: seqErr } = await svc.rpc('next_one_vs_one_move_sequence', { p_room_id: room_id });
    if (seqErr) throw seqErr;

    const { error: moveErr } = await svc.from('one_vs_one_moves').insert({
      room_id,
      player_id: user.id,
      sequence,
      action: 'play_tile',
      payload: { tile, branch: branch ?? null, moveScore, wasOpeningMove: isOpeningRound && boardEmpty },
    });

    if (moveErr) throw moveErr;

    return json({ ok: true, state: { ...nextState, myHand: finalHands[playerIndex] ?? [] }, room: updatedRoom }, 200);
  } catch (err) {
    console.error('submit_one_vs_one_move error', err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
