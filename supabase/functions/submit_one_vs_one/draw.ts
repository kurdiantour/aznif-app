// @ts-nocheck

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { canHandMove } from '../_shared/kozel-engine.ts';
import { handCounts } from '../_shared/game-utils.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('EXPO_PUBLIC_SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const svc = createClient(SUPABASE_URL ?? '', SUPABASE_SERVICE_ROLE_KEY ?? '', {
  auth: { persistSession: false },
});

const MAX_ONE_VS_ONE_DRAWS_PER_TURN = 3;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function canDrawForPlayer(playerIndex: number, hands: any[][], boneyard: any[], state: any) {
  if (!state.board?.centerTile || boneyard.length === 0 || state.roundWinnerPlayerId || state.winningTeamId) {
    return false;
  }

  if (Number(state.currentTurnDrawCount ?? 0) >= MAX_ONE_VS_ONE_DRAWS_PER_TURN) {
    return false;
  }

  return !canHandMove(
    hands[playerIndex] ?? [],
    state.board,
    state.spinnerValue ?? null,
    state.isOpeningRound ?? state.isFirstRound ?? true,
    typeof state.openingDouble === 'number' ? state.openingDouble : null,
  );
}

export default async function handler(req: Request) {
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
    if (state.winningTeamId || state.roundWinnerPlayerId) return json({ error: 'Round is not drawable' }, 400);

    const { data: players, error: playersErr } = await svc
      .from('one_vs_one_players')
      .select('id, user_id, player_index')
      .eq('room_id', room_id)
      .order('player_index', { ascending: true });

    if (playersErr) throw playersErr;
    if (!Array.isArray(players) || players.length !== 2) return json({ error: '1v1 requires exactly 2 players' }, 400);

    const playerIndex = players.findIndex((player: any) => player.user_id === user.id);
    if (playerIndex === -1) return json({ error: 'You are not a player in this 1v1 room' }, 403);

    const currentTurnPlayerId = state.currentTurnPlayerId ?? null;
    if (currentTurnPlayerId !== user.id) {
      return json({ error: 'Not your turn' }, 403);
    }

    const { data: privateState, error: privateErr } = await svc
      .from('one_vs_one_private_states')
      .select('hands, boneyard')
      .eq('room_id', room_id)
      .maybeSingle();

    if (privateErr) throw privateErr;
    if (!privateState) return json({ error: '1v1 private state is missing' }, 409);

    const hands = Array.isArray(privateState.hands) ? privateState.hands : [];
    const boneyard = Array.isArray(privateState.boneyard) ? privateState.boneyard : [];

    if (!canDrawForPlayer(playerIndex, hands, boneyard, state)) {
      return json({ error: 'Draw is not currently allowed' }, 400);
    }

    const drawnTile = boneyard[0];
    const nextBoneyard = boneyard.slice(1);
    const nextHands = hands.map((hand: any[], index: number) =>
      index === playerIndex ? [...hand, drawnTile] : hand,
    );

    const stillHasPlayableTile = canHandMove(
      nextHands[playerIndex] ?? [],
      state.board,
      state.spinnerValue ?? null,
      state.isOpeningRound ?? state.isFirstRound ?? true,
      typeof state.openingDouble === 'number' ? state.openingDouble : null,
    );

    const currentTurnDrawCount = Number(state.currentTurnDrawCount ?? 0);
    const nextTurnDrawCount = currentTurnDrawCount + 1;

    const opponent = players.find((player: any) => player.user_id !== user.id);
    const opponentPlayerId = opponent?.user_id ?? currentTurnPlayerId;

    const shouldAutoPass =
      !stillHasPlayableTile && nextTurnDrawCount >= MAX_ONE_VS_ONE_DRAWS_PER_TURN;

    const finalTurnPlayerId = shouldAutoPass
      ? opponentPlayerId
      : currentTurnPlayerId;

    const nextState = {
      ...state,
      mode: '1v1',
      currentTurnPlayerId: finalTurnPlayerId,
      ...(shouldAutoPass ? { turnStartedAt: new Date().toISOString() } : {}),
      handCounts: handCounts(nextHands),
      boneyardCount: nextBoneyard.length,
      canDrawTile: !shouldAutoPass && !stillHasPlayableTile && nextBoneyard.length > 0,
      currentTurnDrawCount: shouldAutoPass ? 0 : nextTurnDrawCount,
      lastDrawnTile: null,
      lastPassedPlayerId: shouldAutoPass ? user.id : null,
      blockedPasses: shouldAutoPass ? [user.id] : [],
    };

    const { data: updatedRoom, error: commitError } = await svc.rpc('commit_multiplayer_action', {
      p_mode: '1v1', p_room_id: room_id, p_expected_version: room.version,
      p_state: nextState, p_hands: nextHands, p_boneyard: nextBoneyard,
      p_current_turn_player_id: finalTurnPlayerId, p_status: null,
      p_player_id: user.id, p_action: shouldAutoPass ? 'draw_tile_auto_pass' : 'draw_tile',
      p_payload: {
        remainingBoneyard: nextBoneyard.length,
        currentTurnDrawCount: nextTurnDrawCount,
        autoPassed: shouldAutoPass,
      },
    });
    if (commitError) {
      if (commitError.message?.includes('STALE_GAME_STATE')) return json({ error: 'Stale 1v1 state, please retry' }, 409);
      throw commitError;
    }

    return json(
      {
        ok: true,
        state: { ...nextState, myHand: nextHands[playerIndex] ?? [] },
        room: updatedRoom,
      },
      200,
    );
  } catch (err) {
    console.error('submit_one_vs_one action=draw error', err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
}
