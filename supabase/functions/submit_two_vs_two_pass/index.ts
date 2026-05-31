// @ts-nocheck

import { createClient } from '@supabase/supabase-js';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { canAnyPlayerMove, canHandMove } from '../../../lib/game/kozel-engine';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('EXPO_PUBLIC_SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const svc = createClient(SUPABASE_URL ?? '', SUPABASE_SERVICE_ROLE_KEY ?? '', {
  auth: { persistSession: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
      .from('two_vs_two_rooms')
      .select('id, status, state, version, current_turn_player_id')
      .eq('id', room_id)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) return json({ error: '2v2 room not found' }, 404);
    if (room.status !== 'active') return json({ error: '2v2 room is not active' }, 400);

    const state = room.state || {};
    if (!state.board?.centerTile) return json({ error: 'Cannot pass before opening move' }, 400);
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
    const hasPlayable = canHandMove(
      hands[playerIndex] ?? [],
      state.board,
      state.spinnerValue ?? null,
      state.isOpeningRound ?? state.isFirstRound ?? true,
      typeof state.openingDouble === 'number' ? state.openingDouble : null,
    );
    if (hasPlayable) return json({ error: 'You have a playable tile' }, 400);

    if (!canAnyPlayerMove(hands, state.board, state.spinnerValue ?? null, state.isOpeningRound ?? state.isFirstRound ?? true, typeof state.openingDouble === 'number' ? state.openingDouble : null)) {
      return json({ error: 'Round is blocked; play resolution is handled after moves' }, 400);
    }

    const nextPlayerId = players[(playerIndex + 1) % 4]?.user_id ?? null;
    const nextState = {
      ...state,
      currentTurnPlayerId: nextPlayerId,
      lastPassedPlayerId: user.id,
      canDrawTile: false,
      blockedPasses: Array.from(new Set([...(state.blockedPasses ?? []), user.id])),
    };

    const { data: updatedRoom, error: updateErr } = await svc
      .from('two_vs_two_rooms')
      .update({ state: nextState, version: Number(room.version ?? 0) + 1, current_turn_player_id: nextPlayerId })
      .eq('id', room_id)
      .eq('version', room.version)
      .select()
      .maybeSingle();
    if (updateErr) throw updateErr;
    if (!updatedRoom) return json({ error: 'Stale 2v2 state, please retry' }, 409);

    const { data: sequence, error: seqErr } = await svc.rpc('next_two_vs_two_move_sequence', { p_room_id: room_id });
    if (seqErr) throw seqErr;

    const { error: moveErr } = await svc.from('two_vs_two_moves').insert({
      room_id,
      player_id: user.id,
      sequence,
      action: 'pass_turn',
      payload: { nextPlayerId },
    });
    if (moveErr) throw moveErr;

    return json({ ok: true, state: { ...nextState, myHand: hands[playerIndex] ?? [] }, room: updatedRoom }, 200);
  } catch (err) {
    console.error('submit_two_vs_two_pass error', err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
