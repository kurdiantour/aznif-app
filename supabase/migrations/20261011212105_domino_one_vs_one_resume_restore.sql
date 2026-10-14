-- Restore a timed-out Domino Fun 1v1 player to the same active room.
-- The function only changes seat control; it never changes room state or economy.
CREATE OR REPLACE FUNCTION public.restore_one_vs_one_human_control(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
  v_changed boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Serialize restores with actions and settlement for this room.
  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;
  IF v_room.status <> 'active'
    OR v_room.state->>'status' IN ('finished', 'cancelled', 'completed')
    OR v_room.state->>'matchFinished' = 'true' THEN
    RAISE EXCEPTION '1v1 room is not active';
  END IF;

  SELECT * INTO v_player
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND kind = 'human'
    AND abandoned = false
    AND left_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active player in this 1v1 room' USING ERRCODE = '42501';
  END IF;

  v_changed := v_player.bot_takeover OR NOT v_player.connected;

  UPDATE public.one_vs_one_players
  SET bot_takeover = false,
      takeover_started_at = NULL,
      takeover_expires_at = NULL,
      connected = true,
      last_seen_at = now(),
      consecutive_timeout_strikes = 0,
      updated_at = now()
  WHERE id = v_player.id;

  -- A retry is safe and does not add duplicate restore events.
  IF v_changed THEN
    INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
    VALUES (
      p_room_id,
      v_user_id,
      public.next_one_vs_one_move_sequence(p_room_id),
      'takeover_restored',
      jsonb_build_object('user_id', v_user_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'room_id', p_room_id,
    'restored', v_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_one_vs_one_human_control(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_one_vs_one_human_control(uuid) TO authenticated;
