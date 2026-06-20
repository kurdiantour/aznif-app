// @ts-nocheck

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { canAnyPlayerMove, canHandMove } from '../_shared/kozel-engine.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('EXPO_PUBLIC_SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const svc = createClient(SUPABASE_URL ?? '', SUPABASE_SERVICE_ROLE_KEY ?? '', {
  auth: { persistSession: false },
});
const TURN_DURATION_MS = 20_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req: Request) {
  try {
    if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const { data: userData, error: userError } = await svc.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: 'Invalid auth token' }, 401);

    const user = userData.user;
    const { room_id, timed_out: timedOut = false } = await req.json();
    if (!room_id) return json({ error: 'Missing room_id' }, 400);

    const { data: room, error: roomErr } = await svc
      .from('two_vs_two_rooms')
      .select('id, status, state, version, current_turn_player_id, updated_at')
      .eq('id', room_id)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) return json({ error: '2v2 room not found' }, 404);
    if (room.status !== 'active') return json({ error: '2v2 room is not active' }, 400);

    const state = room.state || {};
    if (!timedOut && !state.board?.centerTile) return json({ error: 'Cannot pass before opening move' }, 400);
    if (state.winningTeamId) return json({ error: '2v2 match is already finished' }, 400);

    const { data: players, error: playersErr } = await svc
      .from('two_vs_two_players')
      .select('id, user_id, player_index, seat, team_id, kind')
      .eq('room_id', room_id)
      .order('player_index', { ascending: true });
    if (playersErr) throw playersErr;
    if (!Array.isArray(players) || players.length !== 4) return json({ error: '2v2 requires exactly 4 players' }, 400);

    const requestPlayerIndex = players.findIndex((player) => player.user_id === user.id);
    if (requestPlayerIndex === -1) return json({ error: 'You are not a player in this 2v2 room' }, 403);
    const currentTurnPlayerId = room.current_turn_player_id ?? state.currentTurnPlayerId;
    const playerIndex = players.findIndex((player) => player.user_id === currentTurnPlayerId);
    if (playerIndex === -1) return json({ error: 'Active player is missing' }, 409);
    if (timedOut) {
      const turnStartedAt = Date.parse(state.turnStartedAt ?? room.updated_at ?? '');
      if (!Number.isFinite(turnStartedAt) || Date.now() - turnStartedAt < TURN_DURATION_MS) return json({ error: 'Turn timer has not expired' }, 409);
    } else if (currentTurnPlayerId !== user.id) return json({ error: 'Not your turn' }, 403);

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
    if (!timedOut && hasPlayable) return json({ error: 'You have a playable tile' }, 400);

    if (!timedOut && !canAnyPlayerMove(hands, state.board, state.spinnerValue ?? null, state.isOpeningRound ?? state.isFirstRound ?? true, typeof state.openingDouble === 'number' ? state.openingDouble : null)) {
      return json({ error: 'Round is blocked; play resolution is handled after moves' }, 400);
    }

    const nextPlayerId = players[(playerIndex + 1) % 4]?.user_id ?? null;
    const nextState = {
      ...state,
      currentTurnPlayerId: nextPlayerId,
      lastPassedPlayerId: currentTurnPlayerId,
      turnStartedAt: new Date().toISOString(),
      canDrawTile: false,
      blockedPasses: Array.from(new Set([...(state.blockedPasses ?? []), currentTurnPlayerId])),
    };

    const { data: updatedRoom, error: commitError } = await svc.rpc('commit_multiplayer_action', {
      p_mode: '2v2', p_room_id: room_id, p_expected_version: room.version,
      p_state: nextState, p_hands: hands, p_boneyard: privateState.boneyard ?? [],
      p_current_turn_player_id: nextPlayerId, p_status: null,
      p_player_id: currentTurnPlayerId, p_action: 'pass_turn', p_payload: { nextPlayerId, timedOut },
    });
    if (commitError) {
      if (commitError.message?.includes('STALE_GAME_STATE')) return json({ error: 'Stale 2v2 state, please retry' }, 409);
      throw commitError;
    }

    return json({
      ok: true,
      state: {
        ...nextState,
        myHand: hands[requestPlayerIndex] ?? [],
        myHandOwnerId: user.id,
      },
      room: updatedRoom,
    }, 200);
  } catch (err) {
    console.error('submit_two_vs_two action=pass error', err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
}
