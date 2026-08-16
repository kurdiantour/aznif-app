-- ============================================================
-- Domino: Zero-Human Finalization for Timeout Strike Bot Takeover
-- ============================================================

-- 1. central helper check_and_finalize_zero_human_room
CREATE OR REPLACE FUNCTION public.check_and_finalize_zero_human_room(
  p_mode text,
  p_room_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_humans_remaining integer;
  v_final_state jsonb;
  v_room_status text;
BEGIN
  IF p_mode = '1v1' THEN
    -- Lock room row for update to ensure safe concurrent execution
    SELECT status INTO v_room_status
    FROM public.one_vs_one_rooms
    WHERE id = p_room_id
    FOR UPDATE;

    IF NOT FOUND OR v_room_status = 'finished' THEN
      RETURN false;
    END IF;

    -- Count active human players remaining
    SELECT COUNT(*)::integer INTO v_humans_remaining
    FROM public.one_vs_one_players
    WHERE room_id = p_room_id
      AND kind = 'human'
      AND bot_takeover = false;

    IF v_humans_remaining = 0 THEN
      -- Settle/finish 1v1 room immediately using current settlement authority
      SELECT COALESCE(state, '{}'::jsonb) || jsonb_build_object(
        'status', 'finished',
        'matchFinished', true,
        'winningTeamId', NULL,
        'finishReason', 'all_players_manual_leave',
        'forfeitReason', 'no_humans_remaining',
        'canDrawTile', false
      ) INTO v_final_state
      FROM public.one_vs_one_rooms
      WHERE id = p_room_id;

      UPDATE public.one_vs_one_players
      SET connected = false,
          bot_takeover = true,
          abandoned = true,
          updated_at = now()
      WHERE room_id = p_room_id;

      UPDATE public.one_vs_one_rooms
      SET status = 'finished',
          state = v_final_state,
          current_turn_player_id = NULL,
          version = version + 1,
          updated_at = now()
      WHERE id = p_room_id;

      INSERT INTO public.one_vs_one_moves (room_id, player_id, sequence, action, payload)
      VALUES (
        p_room_id,
        NULL,
        public.next_one_vs_one_move_sequence(p_room_id),
        'all_players_manual_leave',
        jsonb_build_object(
          'reason', 'no_humans_remaining',
          'humans_before', 1,
          'humans_after', 0
        )
      );

      PERFORM public.domino_settle_match('1v1', p_room_id);
      RETURN true;
    END IF;

  ELSIF p_mode = '2v2' THEN
    -- Lock room row for update to ensure safe concurrent execution
    SELECT status INTO v_room_status
    FROM public.two_vs_two_rooms
    WHERE id = p_room_id
    FOR UPDATE;

    IF NOT FOUND OR v_room_status = 'finished' THEN
      RETURN false;
    END IF;

    -- Count active human players remaining
    SELECT COUNT(*)::integer INTO v_humans_remaining
    FROM public.two_vs_two_players
    WHERE room_id = p_room_id
      AND kind = 'human'
      AND bot_takeover = false;

    IF v_humans_remaining = 0 THEN
      -- Settle/finish 2v2 room immediately using current settlement authority
      SELECT COALESCE(state, '{}'::jsonb) || jsonb_build_object(
        'status', 'finished',
        'matchFinished', true,
        'winningTeamId', NULL,
        'finishReason', 'all_players_manual_leave',
        'forfeitReason', 'no_humans_remaining',
        'canDrawTile', false
      ) INTO v_final_state
      FROM public.two_vs_two_rooms
      WHERE id = p_room_id;

      UPDATE public.two_vs_two_players
      SET connected = false,
          bot_takeover = true,
          abandoned = true,
          updated_at = now()
      WHERE room_id = p_room_id;

      UPDATE public.two_vs_two_rooms
      SET status = 'finished',
          state = v_final_state,
          current_turn_player_id = NULL,
          version = version + 1,
          updated_at = now()
      WHERE id = p_room_id;

      INSERT INTO public.two_vs_two_moves (room_id, player_id, sequence, action, payload)
      VALUES (
        p_room_id,
        NULL,
        public.next_two_vs_two_move_sequence(p_room_id),
        'all_players_manual_leave',
        jsonb_build_object(
          'reason', 'no_humans_remaining',
          'humans_before', 1,
          'humans_after', 0
        )
      );

      PERFORM public.domino_settle_match('2v2', p_room_id);
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_finalize_zero_human_room(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_finalize_zero_human_room(text, uuid) TO service_role;


-- 2. update apply_one_vs_one_timeout_strike_takeover
CREATE OR REPLACE FUNCTION public.apply_one_vs_one_timeout_strike_takeover(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Idempotent: skip if already taken over.
  UPDATE public.one_vs_one_players
  SET
    bot_takeover = true,
    connected    = false,
    abandoned    = false,
    updated_at   = now()
  WHERE room_id      = p_room_id
    AND user_id      = p_user_id
    AND bot_takeover = false;

  IF FOUND THEN
    PERFORM public.check_and_finalize_zero_human_room('1v1', p_room_id);
  END IF;
END;
$$;


-- 3. update apply_two_vs_two_timeout_strike_takeover
CREATE OR REPLACE FUNCTION public.apply_two_vs_two_timeout_strike_takeover(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Idempotent: skip if already taken over.
  UPDATE public.two_vs_two_players
  SET
    bot_takeover = true,
    connected    = false,
    abandoned    = false,
    updated_at   = now()
  WHERE room_id      = p_room_id
    AND user_id      = p_user_id
    AND bot_takeover = false;

  IF FOUND THEN
    PERFORM public.check_and_finalize_zero_human_room('2v2', p_room_id);
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
