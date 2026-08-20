-- ============================================================
-- Domino Consecutive Timeout Takeover
-- Single source of truth for timeout-driven takeover in Domino 1v1 + 2v2.
--
-- FINAL RULE:
--   valid human action -> consecutive_timeout_strikes = 0
--   completed timeout #1 -> strike = 1
--   completed timeout #2 -> seat is locked for bot takeover
--   before that seat receives another human timer:
--       bot_takeover = true
--       connected = false
--
-- Heartbeat / presence / reconnect / disconnect are intentionally NOT defined here.
-- They belong to the separate presence system and have zero authority over takeover.
-- Bot turn execution remains exclusively in process_bot_turns.
-- ============================================================

ALTER TABLE public.one_vs_one_players
  ADD COLUMN IF NOT EXISTS consecutive_timeout_strikes integer NOT NULL DEFAULT 0;

ALTER TABLE public.two_vs_two_players
  ADD COLUMN IF NOT EXISTS consecutive_timeout_strikes integer NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- Finish a room with no human-controlled seats left.
-- Used by timeout takeover application below.
-- ------------------------------------------------------------

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
    SELECT status INTO v_room_status
    FROM public.one_vs_one_rooms
    WHERE id = p_room_id
    FOR UPDATE;

    IF NOT FOUND OR v_room_status = 'finished' THEN
      RETURN false;
    END IF;

    SELECT COUNT(*)::integer INTO v_humans_remaining
    FROM public.one_vs_one_players
    WHERE room_id = p_room_id
      AND kind = 'human'
      AND bot_takeover = false;

    IF v_humans_remaining = 0 THEN
      SELECT COALESCE(state, '{}'::jsonb) || jsonb_build_object(
        'status', 'finished',
        'matchFinished', true,
        'winningTeamId', NULL,
        'finishReason', 'no_humans_remaining',
        'forfeitReason', 'no_humans_remaining',
        'canDrawTile', false
      )
      INTO v_final_state
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

      INSERT INTO public.one_vs_one_moves (
        room_id, player_id, sequence, action, payload
      )
      VALUES (
        p_room_id,
        NULL,
        public.next_one_vs_one_move_sequence(p_room_id),
        'no_humans_remaining',
        jsonb_build_object('reason', 'timeout_takeover')
      );

      PERFORM public.domino_settle_match('1v1', p_room_id);
      RETURN true;
    END IF;

  ELSIF p_mode = '2v2' THEN
    SELECT status INTO v_room_status
    FROM public.two_vs_two_rooms
    WHERE id = p_room_id
    FOR UPDATE;

    IF NOT FOUND OR v_room_status = 'finished' THEN
      RETURN false;
    END IF;

    SELECT COUNT(*)::integer INTO v_humans_remaining
    FROM public.two_vs_two_players
    WHERE room_id = p_room_id
      AND kind = 'human'
      AND bot_takeover = false;

    IF v_humans_remaining = 0 THEN
      SELECT COALESCE(state, '{}'::jsonb) || jsonb_build_object(
        'status', 'finished',
        'matchFinished', true,
        'winningTeamId', NULL,
        'finishReason', 'no_humans_remaining',
        'forfeitReason', 'no_humans_remaining',
        'canDrawTile', false
      )
      INTO v_final_state
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

      INSERT INTO public.two_vs_two_moves (
        room_id, player_id, sequence, action, payload
      )
      VALUES (
        p_room_id,
        NULL,
        public.next_two_vs_two_move_sequence(p_room_id),
        'no_humans_remaining',
        jsonb_build_object('reason', 'timeout_takeover')
      );

      PERFORM public.domino_settle_match('2v2', p_room_id);
      RETURN true;
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_match_mode';
  END IF;

  RETURN false;
END;
$$;

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
  UPDATE public.one_vs_one_players
  SET bot_takeover = true,
      connected = false,
      abandoned = false,
      takeover_started_at = now(),
      takeover_expires_at = NULL,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND bot_takeover = false;

  IF FOUND THEN
    PERFORM public.check_and_finalize_zero_human_room('1v1', p_room_id);
  END IF;
END;
$$;

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
  UPDATE public.two_vs_two_players
  SET bot_takeover = true,
      connected = false,
      abandoned = false,
      takeover_started_at = now(),
      takeover_expires_at = NULL,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND bot_takeover = false;

  IF FOUND THEN
    PERFORM public.check_and_finalize_zero_human_room('2v2', p_room_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_one_vs_one_turn_strikes(
  p_room_id uuid,
  p_acting_user_id uuid,
  p_next_user_id uuid,
  p_increment_acting boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next_strikes integer := 0;
BEGIN
  IF p_increment_acting THEN
    UPDATE public.one_vs_one_players
    SET consecutive_timeout_strikes = consecutive_timeout_strikes + 1,
        updated_at = now()
    WHERE room_id = p_room_id
      AND user_id = p_acting_user_id
      AND bot_takeover = false;
  ELSE
    UPDATE public.one_vs_one_players
    SET consecutive_timeout_strikes = 0,
        updated_at = now()
    WHERE room_id = p_room_id
      AND user_id = p_acting_user_id
      AND bot_takeover = false;
  END IF;

  IF p_next_user_id IS NULL OR p_next_user_id = p_acting_user_id THEN
    RETURN false;
  END IF;

  SELECT consecutive_timeout_strikes
  INTO v_next_strikes
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND user_id = p_next_user_id
    AND bot_takeover = false;

  IF COALESCE(v_next_strikes, 0) >= 2 THEN
    PERFORM public.apply_one_vs_one_timeout_strike_takeover(
      p_room_id,
      p_next_user_id
    );
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_two_vs_two_turn_strikes(
  p_room_id uuid,
  p_acting_user_id uuid,
  p_next_user_id uuid,
  p_increment_acting boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next_strikes integer := 0;
BEGIN
  IF p_increment_acting THEN
    UPDATE public.two_vs_two_players
    SET consecutive_timeout_strikes = consecutive_timeout_strikes + 1,
        updated_at = now()
    WHERE room_id = p_room_id
      AND user_id = p_acting_user_id
      AND bot_takeover = false;
  ELSE
    UPDATE public.two_vs_two_players
    SET consecutive_timeout_strikes = 0,
        updated_at = now()
    WHERE room_id = p_room_id
      AND user_id = p_acting_user_id
      AND bot_takeover = false;
  END IF;

  IF p_next_user_id IS NULL OR p_next_user_id = p_acting_user_id THEN
    RETURN false;
  END IF;

  SELECT consecutive_timeout_strikes
  INTO v_next_strikes
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id
    AND user_id = p_next_user_id
    AND bot_takeover = false;

  IF COALESCE(v_next_strikes, 0) >= 2 THEN
    PERFORM public.apply_two_vs_two_timeout_strike_takeover(
      p_room_id,
      p_next_user_id
    );
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.process_one_vs_one_turn_strikes(uuid, uuid, uuid, boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_one_vs_one_turn_strikes(uuid, uuid, uuid, boolean)
TO service_role;

REVOKE ALL ON FUNCTION public.process_two_vs_two_turn_strikes(uuid, uuid, uuid, boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_two_vs_two_turn_strikes(uuid, uuid, uuid, boolean)
TO service_role;

REVOKE ALL ON FUNCTION public.apply_one_vs_one_timeout_strike_takeover(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_one_vs_one_timeout_strike_takeover(uuid, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.apply_two_vs_two_timeout_strike_takeover(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_two_vs_two_timeout_strike_takeover(uuid, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.check_and_finalize_zero_human_room(text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_finalize_zero_human_room(text, uuid)
TO service_role;







NOTIFY pgrst, 'reload schema';