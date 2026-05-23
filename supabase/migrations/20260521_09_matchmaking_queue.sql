-- Migration: Matchmaking queue system for real-time player pairing
-- This enables players to find and match with each other without manual room codes.

-- ============================================================================
-- matchmaking_queue: Track players actively searching for opponents
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('1v1', '2v2')),
  status text NOT NULL CHECK (status IN ('searching', 'matched', 'cancelled')),
  -- If matched, the room_id they joined
  matched_room_id uuid REFERENCES public.game_rooms(id) ON DELETE SET NULL,
  -- When they started searching
  created_at timestamptz NOT NULL DEFAULT now(),
  -- When they stop searching (matched, cancelled, or timeout)
  ended_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_user_id 
  ON public.matchmaking_queue (user_id);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_mode_status 
  ON public.matchmaking_queue (mode, status) WHERE status IN ('searching', 'matched');
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_created_at 
  ON public.matchmaking_queue (created_at DESC);

-- ============================================================================
-- updated_at trigger for matchmaking_queue
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_matchmaking_queue_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_matchmaking_queue_updated_at 
  ON public.matchmaking_queue;
CREATE TRIGGER trigger_set_matchmaking_queue_updated_at
BEFORE UPDATE ON public.matchmaking_queue
FOR EACH ROW
EXECUTE FUNCTION public.set_matchmaking_queue_updated_at();

-- ============================================================================
-- find_match_opponent: Core matchmaking RPC
-- Attempts to find/create a match for a searching player
-- ============================================================================
CREATE OR REPLACE FUNCTION public.find_match_opponent(p_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_opponent_row public.matchmaking_queue%ROWTYPE;
  v_room public.game_rooms%ROWTYPE;
  v_seat text;
  v_team text;
  v_my_seat text;
  v_my_team text;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_mode NOT IN ('1v1', '2v2') THEN
    RAISE EXCEPTION 'Invalid game mode';
  END IF;

  -- Step 1: Check if user is already in queue or a game
  -- Clean up any stale/old queue entries
  DELETE FROM public.matchmaking_queue
  WHERE user_id = v_user_id 
    AND updated_at < now() - INTERVAL '30 minutes';

  -- Step 2: Try to find an existing opponent waiting for same mode
  SELECT *
  INTO v_opponent_row
  FROM public.matchmaking_queue
  WHERE mode = p_mode 
    AND status = 'searching'
    AND user_id != v_user_id
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    -- ========================================================================
    -- MATCH FOUND: Create room and add both players
    -- ========================================================================
    
    -- Create the room
    INSERT INTO public.game_rooms (
      host_user_id,
      room_code,
      mode,
      status,
      bet_amount,
      player_count,
      max_players
    ) VALUES (
      v_user_id,
      public.generate_room_code(),
      p_mode,
      'waiting',
      0,
      2,
      CASE WHEN p_mode = '1v1' THEN 2 ELSE 4 END
    ) RETURNING * INTO v_room;

    -- Add me (searching player)
    SELECT seat, team_id
    INTO v_my_seat, v_my_team
    FROM public.resolve_room_seat_assignment(p_mode, 0);

    INSERT INTO public.game_players (
      game_id,
      user_id,
      kind,
      seat,
      team_id,
      player_index,
      is_ready,
      connected
    ) VALUES (
      v_room.id,
      v_user_id,
      'human',
      v_my_seat,
      v_my_team,
      0,
      true,
      true
    );

    -- Add opponent (second player)
    SELECT seat, team_id
    INTO v_seat, v_team
    FROM public.resolve_room_seat_assignment(p_mode, 1);

    INSERT INTO public.game_players (
      game_id,
      user_id,
      kind,
      seat,
      team_id,
      player_index,
      is_ready,
      connected
    ) VALUES (
      v_room.id,
      v_opponent_row.user_id,
      'human',
      v_seat,
      v_team,
      1,
      true,
      true
    );

    -- Record initial move
    INSERT INTO public.game_moves (
      game_id,
      player_id,
      sequence,
      action,
      payload
    ) VALUES (
      v_room.id,
      v_user_id,
      public.next_game_move_sequence(v_room.id),
      'match_created',
      jsonb_build_object(
        'player_1', v_user_id,
        'player_2', v_opponent_row.user_id
      )
    );

    -- Update both queue entries to matched
    UPDATE public.matchmaking_queue
    SET status = 'matched',
        matched_room_id = v_room.id,
        ended_at = now()
    WHERE user_id IN (v_user_id, v_opponent_row.user_id);

    v_result := jsonb_build_object(
      'status', 'matched',
      'room_id', v_room.id,
      'room_code', v_room.room_code,
      'opponent_user_id', v_opponent_row.user_id,
      'message', 'Match found with opponent'
    );

  ELSE
    -- ========================================================================
    -- NO MATCH: Add to queue and wait
    -- ========================================================================
    
    -- Remove any existing queue entry
    DELETE FROM public.matchmaking_queue
    WHERE user_id = v_user_id;

    -- Add self to queue
    INSERT INTO public.matchmaking_queue (
      user_id,
      mode,
      status
    ) VALUES (
      v_user_id,
      p_mode,
      'searching'
    );

    v_result := jsonb_build_object(
      'status', 'searching',
      'message', 'Added to matchmaking queue, waiting for opponent...'
    );
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- cancel_matchmaking: Remove user from queue or abandon room
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_matchmaking(p_game_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Remove from queue
  UPDATE public.matchmaking_queue
  SET status = 'cancelled',
      ended_at = now()
  WHERE user_id = v_user_id
    AND status IN ('searching', 'matched');

  -- If game_id provided, mark player as left
  IF p_game_id IS NOT NULL THEN
    UPDATE public.game_players
    SET left_at = now()
    WHERE game_id = p_game_id
      AND user_id = v_user_id
      AND left_at IS NULL;
  END IF;

  v_result := jsonb_build_object(
    'status', 'cancelled',
    'message', 'Matchmaking cancelled'
  );

  RETURN v_result;
END;
$$;

-- ============================================================================
-- get_matchmaking_status: Check current queue status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_matchmaking_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.matchmaking_queue%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_row
  FROM public.matchmaking_queue
  WHERE user_id = v_user_id
    AND status IN ('searching', 'matched')
  ORDER BY updated_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_result := jsonb_build_object(
      'status', v_row.status,
      'mode', v_row.mode,
      'matched_room_id', v_row.matched_room_id,
      'wait_seconds', 
        EXTRACT(EPOCH FROM (now() - v_row.created_at))::int
    );
  ELSE
    v_result := jsonb_build_object(
      'status', 'none'
    );
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- Clean up stale matchmaking entries (call periodically)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cleanup_stale_matchmaking()
RETURNS TABLE(cleaned_count int)
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted int;
BEGIN
  -- Remove entries older than 5 minutes
  DELETE FROM public.matchmaking_queue
  WHERE status = 'searching'
    AND created_at < now() - INTERVAL '5 minutes';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_deleted;
END;
$$;

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT SELECT ON public.matchmaking_queue TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_match_opponent(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_matchmaking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_matchmaking_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_matchmaking() TO authenticated;
