// @ts-nocheck

import { createClient } from '@supabase/supabase-js';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { applyMove, canAnyPlayerMove, createEmptyBoard, isValidMove } from '../../../lib/game/kozel-engine';

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
  return { hands: [tiles.slice(0, 7), tiles.slice(7, 14), tiles.slice(14, 21), tiles.slice(21, 28)], boneyard: [] };
}

function isSameTile(a: any, b: any) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  return (
    (Number(a.left) === Number(b.left) && Number(a.right) === Number(b.right)) ||
    (Number(a.left) === Number(b.right) && Number(a.right) === Number(b.left))
  );
}

function isBoardEmpty(board: any) {
  if (!board) return true;
  return !board.centerTile && !Object.values(board.branches ?? {}).some((branch: any) => Array.isArray(branch?.tiles) && branch.tiles.length > 0);
}

function pipTotal(hand: any[]) {
  return hand.reduce((sum, tile) => sum + Number(tile.left ?? 0) + Number(tile.right ?? 0), 0);
}

function roundToNearestFive(value: number) {
  return Math.round(value / 5) * 5;
}

function handCounts(hands: any[][]) {
  return hands.map((hand) => hand.length);
}

function reward(winnerScore: number, loserScore: number) {
  const diff = Math.max(0, winnerScore - loserScore);
  if (diff <= 50) return { tier: 'close', gold: 3, points: 10 };
  if (diff <= 150) return { tier: 'normal', gold: 6, points: 20 };
  return { tier: 'dominating', gold: 9, points: 30 };
}

function finishMatch(scores: any, state: any) {
  if (scores.teamA < MATCH_TARGET && scores.teamB < MATCH_TARGET) return { winningTeamId: null, matchReward: null };
  let winningTeamId = null;
  if (scores.teamA > scores.teamB) winningTeamId = 'teamA';
  if (scores.teamB > scores.teamA) winningTeamId = 'teamB';
  if (!winningTeamId) return { winningTeamId: null, matchReward: null };
  const winnerScore = Number(scores[winningTeamId] ?? 0);
  const loserScore = winningTeamId === 'teamA' ? Number(scores.teamB ?? 0) : Number(scores.teamA ?? 0);
  return { winningTeamId, matchReward: state.matchReward ?? reward(winnerScore, loserScore) };
}

function scoreOpponentPips(hands: any[][], players: any[], winnerTeamId: string) {
  return hands.reduce((sum, hand, index) => {
    if (players[index]?.team_id === winnerTeamId) return sum;
    return sum + pipTotal(hand ?? []);
  }, 0);
}

function startNextHand(state: any, leaderPlayerId: string | null, players: any[]) {
  const { hands, boneyard } = dealHands();
  let openingDouble = null;
  let leaderIndex = Math.max(0, players.findIndex((player) => player.user_id === leaderPlayerId));
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
      boneyardCount: 0,
      currentTurnPlayerId,
      leaderPlayerId: currentTurnPlayerId,
      openingDouble,
      openingTileId: openingDouble === null ? null : `${openingDouble}-${openingDouble}`,
      isOpeningRound: true,
      isFirstRound: true,
      roundWinnerPlayerId: null,
      lastPlayedTile: null,
      lastPassedPlayerId: null,
      blockedPasses: [],
      canDrawTile: false,
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

    const { room_id, tile, branch } = await req.json();
    if (!room_id || !tile?.id) return json({ error: 'Missing parameters' }, 400);

    const user = userData.user;
    const { data: room, error: roomErr } = await svc
      .from('two_vs_two_rooms')
      .select('id, status, state, version, current_turn_player_id')
      .eq('id', room_id)
      .maybeSingle();

    if (roomErr) throw roomErr;
    if (!room) return json({ error: '2v2 room not found' }, 404);
    if (room.status !== 'active') return json({ error: '2v2 room is not active' }, 400);

    const state = room.state || {};
    if (state.winningTeamId) return json({ error: '2v2 match is already finished' }, 400);

    const { data: players, error: playersErr } = await svc
      .from('two_vs_two_players')
      .select('id, user_id, player_index, seat, team_id, kind')
      .eq('room_id', room_id)
      .order('player_index', { ascending: true });

    if (playersErr) throw playersErr;
    if (!Array.isArray(players) || players.length !== 4) return json({ error: '2v2 requires exactly 4 players' }, 400);

    const playerIndex = players.findIndex((player) => player.user_id === user.id);
    if (playerIndex === -1) return json({ error: 'You are not a player in this 2v2 room' }, 403);
    if ((room.current_turn_player_id ?? state.currentTurnPlayerId) !== user.id) return json({ error: 'Not your turn' }, 403);

    const { data: privateState, error: privateErr } = await svc
      .from('two_vs_two_private_states')
      .select('hands, boneyard')
      .eq('room_id', room_id)
      .maybeSingle();

    if (privateErr) throw privateErr;
    if (!privateState) return json({ error: '2v2 private state is missing' }, 409);

    const hands = Array.isArray(privateState.hands) ? privateState.hands : [];
    const myHand = Array.isArray(hands[playerIndex]) ? hands[playerIndex] : [];
    const tileIndex = myHand.findIndex((handTile) => isSameTile(handTile, tile));
    if (tileIndex === -1) return json({ error: 'Tile not found in your hand' }, 400);

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

    const { board: nextBoard, spinnerValue: nextSpinnerValue, moveScore } = applyMove(board, tile, branch, spinnerValue, isOpeningRound);
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
    const nextScores = { teamA: Number(state.teamScores?.teamA ?? 0), teamB: Number(state.teamScores?.teamB ?? 0) };
    let lastScoringEvent = null;
    if (moveScore > 0) {
      nextScores[currentPlayer.team_id] = Number(nextScores[currentPlayer.team_id] ?? 0) + Number(moveScore);
      lastScoringEvent = { playerId: user.id, teamId: currentPlayer.team_id, points: moveScore, openEndsTotal: moveScore };
    }

    let nextTurnPlayerId = players[(playerIndex + 1) % 4]?.user_id ?? null;
    let finalHands = nextHands;
    let finalBoneyard = [];
    let nextStatus = 'active';
    let nextState = {
      ...state,
      mode: '2v2',
      board: nextBoard,
      spinnerValue: nextSpinnerValue,
      handCounts: handCounts(nextHands),
      boneyardCount: 0,
      currentTurnPlayerId: nextTurnPlayerId,
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
      const opponentPips = scoreOpponentPips(nextHands, players, currentPlayer.team_id);
      const endScore = roundToNearestFive(opponentPips);
      if (endScore > 0) {
        nextScores[currentPlayer.team_id] = Number(nextScores[currentPlayer.team_id] ?? 0) + endScore;
        lastScoringEvent = { playerId: user.id, teamId: currentPlayer.team_id, points: endScore, openEndsTotal: opponentPips };
      }
      const finished = finishMatch(nextScores, state);
      nextState = { ...nextState, teamScores: nextScores, lastScoringEvent, roundWinnerPlayerId, leaderPlayerId: user.id, winningTeamId: finished.winningTeamId, matchReward: finished.matchReward };
      nextTurnPlayerId = user.id;
      if (finished.winningTeamId) {
        nextStatus = 'finished';
      } else {
        const nextHand = startNextHand(nextState, user.id, players);
        finalHands = nextHand.hands;
        finalBoneyard = nextHand.boneyard;
        nextState = { ...nextHand.publicState, previousRoundWinnerPlayerId: roundWinnerPlayerId, teamScores: nextScores, lastScoringEvent };
        nextTurnPlayerId = nextHand.publicState.currentTurnPlayerId;
      }
    } else if (!canAnyPlayerMove(nextHands, nextBoard, nextSpinnerValue, false, null)) {
      const lowest = players.reduce((best, player, index) => {
        const total = pipTotal(nextHands[index] ?? []);
        return total < best.total ? { index, total } : best;
      }, { index: 0, total: pipTotal(nextHands[0] ?? []) });
      const winner = players[lowest.index];
      const opponentPips = scoreOpponentPips(nextHands, players, winner.team_id);
      const blockScore = roundToNearestFive(opponentPips);
      if (blockScore > 0) {
        nextScores[winner.team_id] = Number(nextScores[winner.team_id] ?? 0) + blockScore;
        lastScoringEvent = { playerId: winner.user_id, teamId: winner.team_id, points: blockScore, openEndsTotal: opponentPips };
      }
      const finished = finishMatch(nextScores, state);
      nextState = { ...nextState, teamScores: nextScores, lastScoringEvent, roundWinnerPlayerId: winner.user_id, leaderPlayerId: user.id, winningTeamId: finished.winningTeamId, matchReward: finished.matchReward };
      nextTurnPlayerId = winner.user_id;
      if (finished.winningTeamId) {
        nextStatus = 'finished';
      } else {
        const nextHand = startNextHand(nextState, user.id, players);
        finalHands = nextHand.hands;
        finalBoneyard = nextHand.boneyard;
        nextState = { ...nextHand.publicState, previousRoundWinnerPlayerId: winner.user_id, teamScores: nextScores, lastScoringEvent };
        nextTurnPlayerId = nextHand.publicState.currentTurnPlayerId;
      }
    }

    const { data: updatedRoom, error: updateErr } = await svc
      .from('two_vs_two_rooms')
      .update({ state: nextState, version: Number(room.version ?? 0) + 1, current_turn_player_id: nextTurnPlayerId, status: nextStatus })
      .eq('id', room_id)
      .eq('version', room.version)
      .select()
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!updatedRoom) return json({ error: 'Stale 2v2 state, please retry' }, 409);

    const { error: privateUpdateErr } = await svc.from('two_vs_two_private_states').upsert({ room_id, hands: finalHands, boneyard: finalBoneyard }, { onConflict: 'room_id' });
    if (privateUpdateErr) throw privateUpdateErr;

    const { data: sequence, error: seqErr } = await svc.rpc('next_two_vs_two_move_sequence', { p_room_id: room_id });
    if (seqErr) throw seqErr;

    const { error: moveErr } = await svc.from('two_vs_two_moves').insert({
      room_id,
      player_id: user.id,
      sequence,
      action: 'play_tile',
      payload: { tile, branch: branch ?? null, moveScore, wasOpeningMove: isOpeningRound && boardEmpty },
    });
    if (moveErr) throw moveErr;

    return json({ ok: true, state: { ...nextState, myHand: finalHands[playerIndex] ?? [] }, room: updatedRoom }, 200);
  } catch (err) {
    console.error('submit_two_vs_two_move error', err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
