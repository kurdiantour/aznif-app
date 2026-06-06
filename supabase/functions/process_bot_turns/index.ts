// @ts-nocheck

import { createClient } from '@supabase/supabase-js';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { applyMove, canHandMove, createEmptyBoard, getPlayableBranches } from '../../../lib/game/kozel-engine';

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

function tableNames(mode: string) {
  if (mode === '2v2') {
    return {
      rooms: 'two_vs_two_rooms',
      players: 'two_vs_two_players',
      privateStates: 'two_vs_two_private_states',
      moves: 'two_vs_two_moves',
      nextSequence: 'next_two_vs_two_move_sequence',
      resolveForfeits: 'resolve_two_vs_two_round_leave_forfeits',
    };
  }

  return {
    rooms: 'one_vs_one_rooms',
    players: 'one_vs_one_players',
    privateStates: 'one_vs_one_private_states',
    moves: 'one_vs_one_moves',
    nextSequence: 'next_one_vs_one_move_sequence',
    resolveForfeits: 'resolve_one_vs_one_round_leave_forfeits',
  };
}

function handCounts(hands: any[][]) {
  return hands.map((hand) => hand.length);
}

function isOpeningRound(state: any) {
  return state.isOpeningRound ?? state.isFirstRound ?? true;
}

function openingDouble(state: any) {
  return typeof state.openingDouble === 'number' ? state.openingDouble : null;
}

function pickBotMove(hand: any[], state: any) {
  const board = state.board ?? createEmptyBoard();
  const spinnerValue = state.spinnerValue ?? null;
  const opening = isOpeningRound(state);
  const requiredDouble = openingDouble(state);

  for (const tile of hand) {
    const branches = getPlayableBranches(tile, board, spinnerValue, opening, requiredDouble);
    if (branches.length) {
      return { tile, branch: branches[0] };
    }
  }

  return null;
}

serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

    const { mode = '1v1', room_id } = await req.json();
    if (!room_id) return json({ error: 'Missing room_id' }, 400);
    if (mode !== '1v1' && mode !== '2v2') return json({ error: 'Invalid mode' }, 400);

    const names = tableNames(mode);

    const { data: room, error: roomErr } = await svc
      .from(names.rooms)
      .select('id, status, state, version, current_turn_player_id')
      .eq('id', room_id)
      .maybeSingle();

    if (roomErr) throw roomErr;
    if (!room) return json({ error: 'Room not found' }, 404);
    if (room.status !== 'active') return json({ ok: true, processed: false, reason: 'room_not_active' });

    const state = room.state ?? {};
    const currentTurnPlayerId =
      mode === '1v1'
        ? state.currentTurnPlayerId ?? null
        : room.current_turn_player_id ?? state.currentTurnPlayerId ?? null;
    if (!currentTurnPlayerId || state.winningTeamId || state.roundWinnerPlayerId) {
      return json({ ok: true, processed: false, reason: 'no_open_bot_turn' });
    }

    const { data: players, error: playersErr } = await svc
      .from(names.players)
      .select('id, user_id, player_index, team_id, bot_takeover, connected, abandoned')
      .eq('room_id', room_id)
      .order('player_index', { ascending: true });

    if (playersErr) throw playersErr;

    const playerIndex = players?.findIndex((player: any) => player.user_id === currentTurnPlayerId) ?? -1;
    const player = playerIndex >= 0 ? players[playerIndex] : null;

    if (mode === '1v1' && playerIndex === -1) {
      const details = {
        reason: 'turn_player_not_found',
        room_id,
        authUserId: null,
        roomCurrentTurnPlayerId: room.current_turn_player_id ?? null,
        stateCurrentTurnPlayerId: state.currentTurnPlayerId ?? null,
        effectiveCurrentTurnPlayerId: currentTurnPlayerId,
        playerIndex,
      };

      console.warn('process_bot_turns 1v1 turn player not found', details);

      return json({ ok: true, processed: false, reason: 'turn_player_not_found', details });
    }

    if (!player?.bot_takeover || player.connected || player.abandoned) {
      return json({ ok: true, processed: false, reason: 'current_player_is_human' });
    }

    const { data: privateState, error: privateErr } = await svc
      .from(names.privateStates)
      .select('hands, boneyard')
      .eq('room_id', room_id)
      .maybeSingle();

    if (privateErr) throw privateErr;
    if (!privateState) return json({ error: 'Private state is missing' }, 409);

    const hands = Array.isArray(privateState.hands) ? privateState.hands : [];
    const boneyard = Array.isArray(privateState.boneyard) ? privateState.boneyard : [];
    const hand = hands[playerIndex] ?? [];
    const botMove = pickBotMove(hand, state);
    const nextPlayerId = players[(playerIndex + 1) % players.length]?.user_id ?? null;
    let nextHands = hands;
    let nextBoneyard = boneyard;
    let nextState = state;
    let action = 'bot_pass_turn';
    let payload: any = { reason: 'bot_takeover' };

    if (botMove) {
      const board = state.board ?? createEmptyBoard();
      const result = applyMove(
        board,
        botMove.tile,
        botMove.branch,
        state.spinnerValue ?? null,
        isOpeningRound(state),
      );

      nextHands = hands.map((playerHand: any[], index: number) => {
        if (index !== playerIndex) return playerHand;
        let removed = false;
        return playerHand.filter((tile: any) => {
          if (!removed && tile.id === botMove.tile.id) {
            removed = true;
            return false;
          }

          return true;
        });
      });

      nextState = {
        ...state,
        board: result.board,
        spinnerValue: result.spinnerValue,
        handCounts: handCounts(nextHands),
        boneyardCount: nextBoneyard.length,
        currentTurnPlayerId: nextPlayerId,
        isOpeningRound: false,
        isFirstRound: false,
        openingDouble: null,
        openingTileId: null,
        lastPlayedTile: botMove.tile,
        lastMoveBranch: botMove.branch,
        lastPassedPlayerId: null,
        blockedPasses: [],
        canDrawTile: false,
      };

      action = 'bot_play_tile';
      payload = { tile: botMove.tile, branch: botMove.branch, reason: 'bot_takeover' };
    } else if (mode === '1v1' && boneyard.length > 0 && state.board?.centerTile) {
      const drawnTile = boneyard[0];
      nextBoneyard = boneyard.slice(1);
      nextHands = hands.map((playerHand: any[], index: number) =>
        index === playerIndex ? [...playerHand, drawnTile] : playerHand,
      );
      const canPlayAfterDraw = canHandMove(
        nextHands[playerIndex] ?? [],
        state.board,
        state.spinnerValue ?? null,
        isOpeningRound(state),
        openingDouble(state),
      );

      nextState = {
        ...state,
        currentTurnPlayerId,
        handCounts: handCounts(nextHands),
        boneyardCount: nextBoneyard.length,
        canDrawTile: !canPlayAfterDraw,
      };

      action = 'bot_draw_tile';
      payload = { remainingBoneyard: nextBoneyard.length, reason: 'bot_takeover' };
    } else {
      nextState = {
        ...state,
        currentTurnPlayerId: nextPlayerId,
        lastPassedPlayerId: currentTurnPlayerId,
        blockedPasses: Array.from(new Set([...(state.blockedPasses ?? []), currentTurnPlayerId])),
        canDrawTile: false,
      };
    }

    const { data: updatedRoom, error: updateErr } = await svc
      .from(names.rooms)
      .update({
        state: nextState,
        version: Number(room.version ?? 0) + 1,
        current_turn_player_id: nextState.currentTurnPlayerId ?? nextPlayerId,
      })
      .eq('id', room_id)
      .eq('version', room.version)
      .select()
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!updatedRoom) return json({ error: 'Stale room state, please retry' }, 409);

    const { error: privateUpdateErr } = await svc
      .from(names.privateStates)
      .upsert({ room_id, hands: nextHands, boneyard: nextBoneyard }, { onConflict: 'room_id' });

    if (privateUpdateErr) throw privateUpdateErr;

    const { data: sequence, error: seqErr } = await svc.rpc(names.nextSequence, { p_room_id: room_id });
    if (seqErr) throw seqErr;

    const { error: moveErr } = await svc.from(names.moves).insert({
      room_id,
      player_id: currentTurnPlayerId,
      sequence,
      action,
      payload,
    });

    if (moveErr) throw moveErr;

    return json({ ok: true, processed: true, action, state: nextState });
  } catch (err) {
    console.error('process_bot_turns error', err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
