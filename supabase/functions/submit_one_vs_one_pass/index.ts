// @ts-nocheck

import { createClient } from '@supabase/supabase-js';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { canHandMove, createEmptyBoard } from '../../../lib/game/kozel-engine';

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

function dealHands() {
  const tiles = [];
  for (let left = 0; left <= 6; left += 1) {
    for (let right = left; right <= 6; right += 1) {
      if (left !== 0 || right !== 0) tiles.push(makeTile(left, right));
    }
  }
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return { hands: [tiles.slice(0, 9), tiles.slice(9, 18)], boneyard: tiles.slice(18) };
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

function finishMatchIfNeeded(scores: any, state: any) {
  if (scores.teamA < MATCH_TARGET && scores.teamB < MATCH_TARGET) {
    return { winningTeamId: null, matchReward: null };
  }

  let winningTeamId = null;
  if (scores.teamA > scores.teamB) winningTeamId = 'teamA';
  if (scores.teamB > scores.teamA) winningTeamId = 'teamB';
  if (!winningTeamId) return { winningTeamId: null, matchReward: null };

  const winnerScore = Number(scores[winningTeamId] ?? 0);
  const loserScore = winningTeamId === 'teamA' ? Number(scores.teamB ?? 0) : Number(scores.teamA ?? 0);
  return { winningTeamId, matchReward: state.matchReward ?? reward(winnerScore, loserScore) };
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
      canDrawTile: false,
      lastPassedPlayerId: null,
      blockedPasses: [],
    },
  };
}

function hasPlayable(playerIndex: number, hands: any[][], state: any) {
  return canHandMove(
    hands[playerIndex] ?? [],
    state.board,
    state.spinnerValue ?? null,
    state.isOpeningRound ?? state.isFirstRound ?? true,
    typeof state.openingDouble === 'number' ? state.openingDouble : null,
  );
}

serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const { data: userData, error: userError } = await svc.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: 'Invalid auth token' }, 401);

    const user = userData.user;
    const { room_id } = await req.json();
    if (!room_id) return json({ error: 'Missing room_id' }, 400);

    const { data: room, error: roomErr } = await svc
      .from('one_vs_one_rooms')
      .select('id, status, state, version, current_turn_player_id')
      .eq('id', room_id)
      .maybeSingle();

    if (roomErr) throw roomErr;
    if (!room) return json({ error: '1v1 room not found' }, 404);
    if (room.status !== 'active') return json({ error: '1v1 room is not active' }, 400);

    const state = room.state || {};
    if (state.winningTeamId || state.roundWinnerPlayerId) return json({ error: 'Round is not passable' }, 400);

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

    if (!state.board?.centerTile) return json({ error: 'Cannot pass before opening move' }, 400);

    const { data: privateState, error: privateErr } = await svc
      .from('one_vs_one_private_states')
      .select('hands, boneyard')
      .eq('room_id', room_id)
      .maybeSingle();

    if (privateErr) throw privateErr;

    if (!privateState) return json({ error: '1v1 private state is missing' }, 409);

    const hands = Array.isArray(privateState.hands) ? privateState.hands : [];
    const boneyard = Array.isArray(privateState.boneyard) ? privateState.boneyard : [];

    if (hasPlayable(playerIndex, hands, state)) return json({ error: 'You have a playable tile' }, 400);
    if (boneyard.length > 0) return json({ error: 'You must draw before passing' }, 400);

    const nextPlayerIndex = (playerIndex + 1) % 2;
    const nextPlayerId = players[nextPlayerIndex]?.user_id ?? null;
    const blockedPasses = Array.from(new Set([...(state.blockedPasses ?? []), user.id]));

    let nextScores = {
      teamA: Number(state.teamScores?.teamA ?? 0),
      teamB: Number(state.teamScores?.teamB ?? 0),
    };
    let finalHands = hands;
    let finalBoneyard = boneyard;
    let nextTurnPlayerId = nextPlayerId;
    let nextStatus = 'active';
    let lastScoringEvent = null;

    let nextState = {
      ...state,
      mode: '1v1',
      currentTurnPlayerId: nextPlayerId,
      canDrawTile: false,
      lastPassedPlayerId: user.id,
      lastScoringEvent: null,
      blockedPasses,
    };

    const opponentCannotPlay = !hasPlayable(nextPlayerIndex, hands, state);

    if (blockedPasses.length >= 2 && opponentCannotPlay) {
      const winnerIndex = pipTotal(hands[0] ?? []) <= pipTotal(hands[1] ?? []) ? 0 : 1;
      const winner = players[winnerIndex];
      const opponentPips = pipTotal(hands[(winnerIndex + 1) % 2] ?? []);
      const blockScore = roundToNearestFive(opponentPips);

      if (blockScore > 0) {
        nextScores[winner.team_id] = Number(nextScores[winner.team_id] ?? 0) + blockScore;
        lastScoringEvent = { playerId: winner.user_id, teamId: winner.team_id, points: blockScore, openEndsTotal: opponentPips };
      }

      const finished = finishMatchIfNeeded(nextScores, state);
      nextState = {
        ...nextState,
        teamScores: nextScores,
        roundWinnerPlayerId: winner.user_id,
        leaderPlayerId: winner.user_id,
        lastScoringEvent,
        winningTeamId: finished.winningTeamId,
        matchReward: finished.matchReward,
      };

      if (finished.winningTeamId) {
        nextTurnPlayerId = winner.user_id;
        nextStatus = 'finished';
      } else {
        const nextHand = startNextHand(nextState, winner.user_id, players);
        finalHands = nextHand.hands;
        finalBoneyard = nextHand.boneyard;
        nextState = {
          ...nextHand.publicState,
          previousRoundWinnerPlayerId: winner.user_id,
          teamScores: nextScores,
          lastScoringEvent,
        };
        nextTurnPlayerId = nextHand.publicState.currentTurnPlayerId;
      }
    } else {
      nextState.canDrawTile = nextPlayerId ? !hasPlayable(nextPlayerIndex, hands, state) : false;
    }

    const { data: updatedRoom, error: updateErr } = await svc
      .from('one_vs_one_rooms')
      .update({
        state: nextState,
        version: Number(room.version ?? 0) + 1,
        current_turn_player_id: nextTurnPlayerId,
        status: nextStatus,
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
      action: 'pass_turn',
      payload: { nextPlayerId: nextTurnPlayerId, blockedRoundResolved: Boolean(nextState.previousRoundWinnerPlayerId) },
    });

    if (moveErr) throw moveErr;

    return json({ ok: true, state: { ...nextState, myHand: finalHands[playerIndex] ?? [] }, room: updatedRoom }, 200);
  } catch (err) {
    console.error('submit_one_vs_one_pass error', err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
