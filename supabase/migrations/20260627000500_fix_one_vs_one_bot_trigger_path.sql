-- Make 1v1 player-state changes observable by the remaining client.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.one_vs_one_players;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END;
$$;

-- Serialize heartbeat with manual leave. Once manual_leave_takeover has been
-- recorded, a late in-flight heartbeat must not restore human control.
CREATE OR REPLACE FUNCTION public.one_vs_one_player_heartbeat(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('status', 'room_not_active', 'room_id', p_room_id);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.one_vs_one_moves
    WHERE room_id = p_room_id
      AND player_id = v_user_id
      AND action = 'manual_leave_takeover'
  ) THEN
    RETURN jsonb_build_object('status', 'manual_leave_locked', 'room_id', p_room_id);
  END IF;

  UPDATE public.one_vs_one_players
  SET connected = true,
      bot_takeover = false,
      takeover_started_at = NULL,
      takeover_expires_at = NULL,
      last_seen_at = now(),
      left_at = NULL,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND abandoned = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active player in this 1v1 room';
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;

-- Boot currently calls this before starting heartbeat, so it needs the same
-- manual-leave guard or reopening the game could undo the takeover.
CREATE OR REPLACE FUNCTION public.restore_one_vs_one_human_control(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('status', 'room_not_active', 'room_id', p_room_id);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.one_vs_one_moves
    WHERE room_id = p_room_id
      AND player_id = v_user_id
      AND action = 'manual_leave_takeover'
  ) THEN
    RETURN jsonb_build_object('status', 'manual_leave_locked', 'room_id', p_room_id);
  END IF;

  UPDATE public.one_vs_one_players
  SET bot_takeover = false,
      takeover_started_at = NULL,
      takeover_expires_at = NULL,
      connected = true,
      last_seen_at = now(),
      left_at = NULL,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND abandoned = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active player in this 1v1 room';
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.one_vs_one_player_heartbeat(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.restore_one_vs_one_human_control(uuid)
TO authenticated;
