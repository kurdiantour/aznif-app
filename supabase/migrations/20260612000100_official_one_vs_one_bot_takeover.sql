CREATE OR REPLACE FUNCTION public.one_vs_one_player_heartbeat(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.one_vs_one_players
  SET connected = true, bot_takeover = false, takeover_started_at = NULL,
      takeover_expires_at = NULL, last_seen_at = now(), left_at = NULL, updated_at = now()
  WHERE room_id = p_room_id AND user_id = v_user_id AND abandoned = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active player in this 1v1 room'; END IF;
  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.leave_one_vs_one_match(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_room FROM public.one_vs_one_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '1v1 room not found'; END IF;
  SELECT * INTO v_player FROM public.one_vs_one_players
  WHERE room_id = p_room_id AND user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not a player in this 1v1 room'; END IF;

  IF v_room.status = 'active' THEN
    UPDATE public.one_vs_one_players
    SET connected = false, left_at = now(), bot_takeover = false,
        takeover_started_at = NULL, takeover_expires_at = now() + interval '30 seconds',
        abandoned = false, updated_at = now()
    WHERE id = v_player.id;
    RETURN jsonb_build_object('status', 'reconnect_grace', 'room_id', p_room_id, 'grace_seconds', 30);
  END IF;

  UPDATE public.one_vs_one_players SET connected = false, left_at = now(), updated_at = now()
  WHERE id = v_player.id;
  UPDATE public.one_vs_one_rooms SET status = 'cancelled', version = version + 1, updated_at = now()
  WHERE id = p_room_id AND status = 'waiting';
  RETURN jsonb_build_object('status', 'left', 'room_id', p_room_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.process_one_vs_one_takeovers(p_grace_seconds int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_player record; v_taken int := 0;
BEGIN
  FOR v_player IN
    SELECT p.* FROM public.one_vs_one_players p
    JOIN public.one_vs_one_rooms r ON r.id = p.room_id
    WHERE r.status = 'active' AND p.bot_takeover = false AND p.abandoned = false
      AND p.connected = false
      AND COALESCE(p.takeover_expires_at, p.last_seen_at + (p_grace_seconds || ' seconds')::interval) <= now()
  LOOP
    UPDATE public.one_vs_one_players
    SET connected = false, bot_takeover = true, takeover_started_at = now(),
        takeover_expires_at = NULL, abandoned = false, updated_at = now()
    WHERE id = v_player.id AND connected = false AND bot_takeover = false AND abandoned = false;
    IF FOUND THEN
      INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
      VALUES (v_player.room_id, v_player.user_id,
        public.next_one_vs_one_move_sequence(v_player.room_id), 'takeover_started',
        jsonb_build_object('player_index', v_player.player_index, 'user_id', v_player.user_id, 'reason', 'disconnect_timeout'));
      v_taken := v_taken + 1;
    END IF;
  END LOOP;
  RETURN v_taken;
END;
$$;
CREATE OR REPLACE FUNCTION public.mark_one_vs_one_player_disconnected(p_room_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.one_vs_one_players
  SET connected = false, bot_takeover = false, takeover_started_at = NULL,
      takeover_expires_at = now() + interval '30 seconds', abandoned = false, updated_at = now()
  WHERE room_id = p_room_id AND user_id = p_user_id AND abandoned = false;
  RETURN jsonb_build_object('status', CASE WHEN FOUND THEN 'ok' ELSE 'not_found' END);
END;
$$;
GRANT EXECUTE ON FUNCTION public.one_vs_one_player_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_one_vs_one_match(uuid) TO authenticated;
