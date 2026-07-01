-- Reliable active-match takeover after one minute without a player heartbeat.
-- A stale heartbeat is authoritative even when a crashed client never had a
-- chance to write connected=false.

CREATE INDEX IF NOT EXISTS idx_one_vs_one_players_takeover_scan
ON public.one_vs_one_players(last_seen_at)
WHERE bot_takeover = false AND abandoned = false;

CREATE INDEX IF NOT EXISTS idx_two_vs_two_players_takeover_scan
ON public.two_vs_two_players(last_seen_at)
WHERE bot_takeover = false AND abandoned = false;

CREATE OR REPLACE FUNCTION public.mark_one_vs_one_player_disconnected(
  p_room_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Cannot disconnect another player';
  END IF;
  UPDATE public.one_vs_one_players
  SET connected = false, bot_takeover = false, takeover_started_at = NULL,
      takeover_expires_at = now() + interval '60 seconds', updated_at = now()
  WHERE room_id = p_room_id AND user_id = v_user_id AND abandoned = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active player in this 1v1 room'; END IF;
  RETURN jsonb_build_object('status','ok','room_id',p_room_id,'grace_seconds',60);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_two_vs_two_player_disconnected(
  p_room_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Cannot disconnect another player';
  END IF;
  UPDATE public.two_vs_two_players
  SET connected = false, bot_takeover = false, takeover_started_at = NULL,
      takeover_expires_at = now() + interval '60 seconds', updated_at = now()
  WHERE room_id = p_room_id AND user_id = v_user_id AND abandoned = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active player in this 2v2 room'; END IF;
  RETURN jsonb_build_object('status','ok','room_id',p_room_id,'grace_seconds',60);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_one_vs_one_takeovers(
  p_grace_seconds integer DEFAULT 60
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff timestamptz := now() - (GREATEST(p_grace_seconds, 60) || ' seconds')::interval;
  v_player public.one_vs_one_players%ROWTYPE;
  v_taken integer := 0;
BEGIN
  FOR v_player IN
    SELECT player.*
    FROM public.one_vs_one_players AS player
    JOIN public.one_vs_one_rooms AS room ON room.id = player.room_id
    WHERE room.status = 'active'
      AND player.bot_takeover = false
      AND player.abandoned = false
      AND (
        (player.connected = false AND COALESCE(
          player.takeover_expires_at,
          COALESCE(player.last_seen_at, player.joined_at, player.updated_at)
            + interval '60 seconds'
        ) <= now())
        OR (player.connected = true
          AND COALESCE(player.last_seen_at, player.joined_at, player.updated_at) < v_cutoff)
      )
    FOR UPDATE OF player SKIP LOCKED
  LOOP
    UPDATE public.one_vs_one_players
    SET connected = false,
        bot_takeover = true,
        takeover_started_at = now(),
        takeover_expires_at = NULL,
        updated_at = now()
    WHERE id = v_player.id
      AND bot_takeover = false
      AND abandoned = false
      AND (
        (connected = false AND COALESCE(
          takeover_expires_at,
          COALESCE(last_seen_at, joined_at, updated_at) + interval '60 seconds'
        ) <= now())
        OR (connected = true
          AND COALESCE(last_seen_at, joined_at, updated_at) < v_cutoff)
      );

    IF FOUND THEN
      INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
      VALUES (
        v_player.room_id,
        v_player.user_id,
        public.next_one_vs_one_move_sequence(v_player.room_id),
        'takeover_started',
        jsonb_build_object(
          'player_index', v_player.player_index,
          'user_id', v_player.user_id,
          'reason', 'heartbeat_timeout',
          'grace_seconds', GREATEST(p_grace_seconds, 60)
        )
      );
      v_taken := v_taken + 1;
    END IF;
  END LOOP;

  RETURN v_taken;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_two_vs_two_takeovers(
  p_grace_seconds integer DEFAULT 60
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff timestamptz := now() - (GREATEST(p_grace_seconds, 60) || ' seconds')::interval;
  v_player public.two_vs_two_players%ROWTYPE;
  v_taken integer := 0;
BEGIN
  FOR v_player IN
    SELECT player.*
    FROM public.two_vs_two_players AS player
    JOIN public.two_vs_two_rooms AS room ON room.id = player.room_id
    WHERE room.status = 'active'
      AND player.bot_takeover = false
      AND player.abandoned = false
      AND (
        (player.connected = false AND COALESCE(
          player.takeover_expires_at,
          COALESCE(player.last_seen_at, player.joined_at, player.updated_at)
            + interval '60 seconds'
        ) <= now())
        OR (player.connected = true
          AND COALESCE(player.last_seen_at, player.joined_at, player.updated_at) < v_cutoff)
      )
    FOR UPDATE OF player SKIP LOCKED
  LOOP
    UPDATE public.two_vs_two_players
    SET connected = false,
        bot_takeover = true,
        takeover_started_at = now(),
        takeover_expires_at = NULL,
        updated_at = now()
    WHERE id = v_player.id
      AND bot_takeover = false
      AND abandoned = false
      AND (
        (connected = false AND COALESCE(
          takeover_expires_at,
          COALESCE(last_seen_at, joined_at, updated_at) + interval '60 seconds'
        ) <= now())
        OR (connected = true
          AND COALESCE(last_seen_at, joined_at, updated_at) < v_cutoff)
      );

    IF FOUND THEN
      INSERT INTO public.two_vs_two_moves(room_id, player_id, sequence, action, payload)
      VALUES (
        v_player.room_id,
        v_player.user_id,
        public.next_two_vs_two_move_sequence(v_player.room_id),
        'takeover_started',
        jsonb_build_object(
          'player_index', v_player.player_index,
          'user_id', v_player.user_id,
          'reason', 'heartbeat_timeout',
          'grace_seconds', GREATEST(p_grace_seconds, 60)
        )
      );
      v_taken := v_taken + 1;
    END IF;
  END LOOP;

  RETURN v_taken;
END;
$$;

REVOKE ALL ON FUNCTION public.process_one_vs_one_takeovers(integer)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_two_vs_two_takeovers(integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_one_vs_one_takeovers(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_two_vs_two_takeovers(integer) TO service_role;
REVOKE ALL ON FUNCTION public.mark_one_vs_one_player_disconnected(uuid,uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_two_vs_two_player_disconnected(uuid,uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_one_vs_one_player_disconnected(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_two_vs_two_player_disconnected(uuid,uuid) TO authenticated;
