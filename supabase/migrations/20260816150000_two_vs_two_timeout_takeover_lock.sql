-- ============================================================
-- Lock heartbeat and manual restore when consecutive_timeout_strikes >= 2
-- ============================================================

CREATE OR REPLACE FUNCTION public.two_vs_two_player_heartbeat(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_player public.two_vs_two_players%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_room FROM public.two_vs_two_rooms
  WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '2v2 room not found'; END IF;
  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('status', 'room_not_active', 'room_id', p_room_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.two_vs_two_moves
    WHERE room_id = p_room_id
      AND player_id = v_user_id
      AND action = 'manual_leave_takeover'
  ) THEN
    RETURN jsonb_build_object('status', 'manual_leave_locked', 'room_id', p_room_id);
  END IF;

  SELECT * INTO v_player FROM public.two_vs_two_players
  WHERE room_id = p_room_id AND user_id = v_user_id;

  IF COALESCE(v_player.consecutive_timeout_strikes, 0) >= 2 THEN
    RETURN jsonb_build_object('status', 'timeout_takeover_locked', 'room_id', p_room_id);
  END IF;

  UPDATE public.two_vs_two_players
  SET connected = true, bot_takeover = false,
      takeover_started_at = NULL, takeover_expires_at = NULL,
      last_seen_at = now(), left_at = NULL, updated_at = now()
  WHERE room_id = p_room_id AND user_id = v_user_id AND abandoned = false;

  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active player in this 2v2 room'; END IF;
  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_two_vs_two_human_control(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_player public.two_vs_two_players%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_room FROM public.two_vs_two_rooms
  WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '2v2 room not found'; END IF;
  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('status', 'room_not_active', 'room_id', p_room_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.two_vs_two_moves
    WHERE room_id = p_room_id
      AND player_id = v_user_id
      AND action = 'manual_leave_takeover'
  ) THEN
    RETURN jsonb_build_object('status', 'manual_leave_locked', 'room_id', p_room_id);
  END IF;

  SELECT * INTO v_player FROM public.two_vs_two_players
  WHERE room_id = p_room_id AND user_id = v_user_id;

  IF COALESCE(v_player.consecutive_timeout_strikes, 0) >= 2 THEN
    RETURN jsonb_build_object('status', 'timeout_takeover_locked', 'room_id', p_room_id);
  END IF;

  UPDATE public.two_vs_two_players
  SET connected = true, bot_takeover = false,
      takeover_started_at = NULL, takeover_expires_at = NULL,
      last_seen_at = now(), left_at = NULL, updated_at = now()
  WHERE room_id = p_room_id AND user_id = v_user_id AND abandoned = false;

  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active player in this 2v2 room'; END IF;
  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.two_vs_two_player_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_two_vs_two_human_control(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
