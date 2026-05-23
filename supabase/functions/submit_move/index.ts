// @ts-nocheck

import { createClient } from '@supabase/supabase-js';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

import {
  applyMove,
  isValidMove,
} from '../../../lib/game/kozel-engine';

const SUPABASE_URL =
  Deno.env.get('SUPABASE_URL') ||
  Deno.env.get('EXPO_PUBLIC_SUPABASE_URL');

const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const svc = createClient(
  SUPABASE_URL ?? '',
  SUPABASE_SERVICE_ROLE_KEY ?? '',
  {
    auth: { persistSession: false },
  },
);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function isSameTile(a: any, b: any) {
  if (!a || !b) return false;

  if (a.id && b.id && a.id === b.id) {
    return true;
  }

  const aLeft = Number(a.left);
  const aRight = Number(a.right);

  const bLeft = Number(b.left);
  const bRight = Number(b.right);

  return (
    (aLeft === bLeft && aRight === bRight) ||
    (aLeft === bRight && aRight === bLeft)
  );
}

function isBoardEmpty(board: any) {
  if (!board) return true;

  const hasCenter = !!board.centerTile;

  const branches = board.branches ?? {};

  const hasBranchTiles = Object.values(branches).some((branch: any) => {
    return Array.isArray(branch?.tiles) && branch.tiles.length > 0;
  });

  return !hasCenter && !hasBranchTiles;
}

serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return json({ error: 'Method Not Allowed' }, 405);
    }

    const authHeader = req.headers.get('authorization') || '';

    const token = authHeader
      .replace(/^Bearer\s+/i, '')
      .trim();

    if (!token) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const { data: userData, error: getUserError } =
      await svc.auth.getUser(token);

    if (getUserError || !userData?.user) {
      return json({ error: 'Invalid auth token' }, 401);
    }

    const user = userData.user;

    const body = await req.json();

    const {
      game_id,
      tile,
      branch,
    } = body as {
      game_id: string;
      tile: any;
      branch?: string;
    };

    if (!game_id || !tile || !tile.id) {
      return json({ error: 'Missing parameters' }, 400);
    }

    const { data: roomRows, error: roomErr } = await svc
      .from('game_rooms')
      .select(
        `
          id,
          status,
          state,
          version,
          current_turn_player_id
        `,
      )
      .eq('id', game_id)
      .limit(1)
      .maybeSingle();

    if (roomErr) {
      throw roomErr;
    }

    if (!roomRows) {
      return json({ error: 'Room not found' }, 404);
    }

    const room = roomRows as any;

    if (room.status !== 'active') {
      return json(
        { error: 'Room is not active' },
        400,
      );
    }

    const state = room.state || {};

    const { data: players, error: playersErr } =
      await svc
        .from('game_players')
        .select('id, user_id, player_index')
        .eq('game_id', game_id)
        .order('player_index', {
          ascending: true,
        });

    if (playersErr) {
      throw playersErr;
    }

    if (!Array.isArray(players) || players.length === 0) {
      return json(
        { error: 'No players found for this room' },
        400,
      );
    }

    const playerRow = players.find(
      (p: any) => p.user_id === user.id,
    );

    if (!playerRow) {
      return json(
        {
          error: 'You are not a player in this room',
        },
        403,
      );
    }

    const playerIndex = players.findIndex((p: any) => p.user_id === user.id);
    

    const currentTurnPlayerId =
      room.current_turn_player_id ??
      state.currentTurnPlayerId;

    if (
      currentTurnPlayerId &&
      currentTurnPlayerId !== user.id
    ) {
      return json({ error: 'Not your turn' }, 403);
    }

    const hands: any[] = Array.isArray(state.hands)
      ? state.hands
      : [];

    const myHand = Array.isArray(hands[playerIndex])
      ? hands[playerIndex]
      : [];

    const tileIndexInHand = myHand.findIndex((t: any) =>
      isSameTile(t, tile),
    );

    if (tileIndexInHand === -1) {
      return json(
        {
          error: 'Tile not found in your hand',
        },
        400,
      );
    }

    const board = state.board ?? {
      centerTile: null,
      branches: {},
    };

    const spinnerValue =
      state.spinnerValue ?? null;

    const isOpeningRound =
      state.isOpeningRound ?? true;

    const openingDouble =
      typeof state.openingDouble === 'number'
        ? state.openingDouble
        : null;

    const boardEmpty = isBoardEmpty(board);

    // Opening rule enforcement
    if (
      isOpeningRound &&
      boardEmpty &&
      openingDouble !== null
    ) {
      const requiredTileId =
        `${openingDouble}-${openingDouble}`;

      const isRequiredOpeningTile =
        tile.id === requiredTileId ||
        (
          Number(tile.left) === openingDouble &&
          Number(tile.right) === openingDouble
        );

      if (!isRequiredOpeningTile) {
        return json(
          {
            error:
              `Opening move must be ${requiredTileId}`,
            requiredTile: requiredTileId,
          },
          400,
        );
      }
    }

    // Full engine validation
    const validMove = isValidMove(
      tile,
      board,
      branch,
      spinnerValue,
      isOpeningRound,
      openingDouble,
    );

    if (!validMove) {
      return json(
        { error: 'Invalid move' },
        400,
      );
    }

    const {
      board: nextBoard,
      spinnerValue: nextSpinnerValue,
    } = applyMove(
      board,
      tile,
      branch,
      spinnerValue,
      isOpeningRound,
    );

    // Remove tile from player hand
    const nextHands = hands.map(
      (hand: any[], idx: number) => {
        if (idx !== playerIndex) {
          return hand;
        }

        let removed = false;

        return hand.filter((t: any) => {
          if (!removed && isSameTile(t, tile)) {
            removed = true;
            return false;
          }

          return true;
        });
      },
    );

    // Turn rotation
    const sortedPlayers = [...players].sort(
      (a: any, b: any) =>
        Number(a.player_index) -
        Number(b.player_index),
    );

    const currentPlayerPosition =
      sortedPlayers.findIndex(
        (p: any) => p.user_id === user.id,
      );

    const nextPlayer =
      sortedPlayers[
        (currentPlayerPosition + 1) %
          sortedPlayers.length
      ];

    const nextPlayerId =
      nextPlayer?.user_id ?? null;

    const nextState = {
      ...state,
      board: nextBoard,
      spinnerValue: nextSpinnerValue,
      hands: nextHands,
      currentTurnPlayerId: nextPlayerId,
      isOpeningRound: false,
      lastPlayedTile: tile,
      lastMoveBranch: branch ?? null,
    };

    const {
      data: updatedRoom,
      error: updateErr,
    } = await svc
      .from('game_rooms')
      .update({
        state: nextState,
        version: Number(room.version ?? 0) + 1,
        current_turn_player_id: nextPlayerId,
      })
      .eq('id', game_id)
      .select()
      .maybeSingle();

    if (updateErr) {
      throw updateErr;
    }

    const {
      data: seqRow,
      error: seqErr,
    } = await svc.rpc(
      'next_game_move_sequence',
      {
        p_game_id: game_id,
      },
    );

    if (seqErr) {
      throw seqErr;
    }

    const seq =
      typeof seqRow === 'number'
        ? seqRow
        : 1;

    const { error: moveErr } =
      await svc
        .from('game_moves')
        .insert({
          game_id,
          player_id: user.id,
          sequence: seq,
          action: 'play_tile',
          payload: {
            tile,
            branch: branch ?? null,
            openingDouble,
            wasOpeningMove:
              isOpeningRound && boardEmpty,
          },
        });

    if (moveErr) {
      throw moveErr;
    }

    return json(
      {
        ok: true,
        state: nextState,
        room: updatedRoom,
      },
      200,
    );
  } catch (err) {
    console.error('submit_move error', err);

    return json(
      {
        error: String(err),
      },
      500,
    );
  }
});