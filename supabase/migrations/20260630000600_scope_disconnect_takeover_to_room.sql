-- Scope takeover scans to the active room that requested the worker. This
-- prevents unrelated production rooms from affecting each other and repairs
-- legacy move_sequence drift before audit moves are appended.

CREATE OR REPLACE FUNCTION public.process_one_vs_one_room_takeovers(
  p_room_id uuid,
  p_grace_seconds integer DEFAULT 60
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_cutoff timestamptz := now() - (GREATEST(p_grace_seconds,60) || ' seconds')::interval;
  v_player public.one_vs_one_players%ROWTYPE;
  v_taken integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_room_id::text,31));
  UPDATE public.one_vs_one_rooms AS room SET move_sequence = GREATEST(
    room.move_sequence,
    COALESCE((SELECT max(move.sequence) FROM public.one_vs_one_moves AS move
      WHERE move.room_id=p_room_id),0)
  ) WHERE room.id=p_room_id AND room.status='active';
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR v_player IN SELECT player.* FROM public.one_vs_one_players AS player
    WHERE player.room_id=p_room_id AND player.bot_takeover=false AND player.abandoned=false
      AND (
        (player.connected=false AND COALESCE(player.takeover_expires_at,
          COALESCE(player.last_seen_at,player.joined_at,player.updated_at)+interval '60 seconds')<=now())
        OR (player.connected=true AND
          COALESCE(player.last_seen_at,player.joined_at,player.updated_at)<v_cutoff)
      ) FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.one_vs_one_players SET connected=false,bot_takeover=true,
      takeover_started_at=now(),takeover_expires_at=NULL,updated_at=now()
    WHERE id=v_player.id AND bot_takeover=false AND abandoned=false
      AND ((connected=false AND COALESCE(takeover_expires_at,
        COALESCE(last_seen_at,joined_at,updated_at)+interval '60 seconds')<=now())
        OR (connected=true AND COALESCE(last_seen_at,joined_at,updated_at)<v_cutoff));
    IF FOUND THEN
      INSERT INTO public.one_vs_one_moves(room_id,player_id,sequence,action,payload)
      VALUES(p_room_id,v_player.user_id,public.next_one_vs_one_move_sequence(p_room_id),
        'takeover_started',jsonb_build_object('player_index',v_player.player_index,
          'user_id',v_player.user_id,'reason','heartbeat_timeout',
          'grace_seconds',GREATEST(p_grace_seconds,60)));
      v_taken:=v_taken+1;
    END IF;
  END LOOP;
  RETURN v_taken;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_two_vs_two_room_takeovers(
  p_room_id uuid,
  p_grace_seconds integer DEFAULT 60
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_cutoff timestamptz := now() - (GREATEST(p_grace_seconds,60) || ' seconds')::interval;
  v_player public.two_vs_two_players%ROWTYPE;
  v_taken integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_room_id::text,31));
  UPDATE public.two_vs_two_rooms AS room SET move_sequence = GREATEST(
    room.move_sequence,
    COALESCE((SELECT max(move.sequence) FROM public.two_vs_two_moves AS move
      WHERE move.room_id=p_room_id),0)
  ) WHERE room.id=p_room_id AND room.status='active';
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR v_player IN SELECT player.* FROM public.two_vs_two_players AS player
    WHERE player.room_id=p_room_id AND player.bot_takeover=false AND player.abandoned=false
      AND (
        (player.connected=false AND COALESCE(player.takeover_expires_at,
          COALESCE(player.last_seen_at,player.joined_at,player.updated_at)+interval '60 seconds')<=now())
        OR (player.connected=true AND
          COALESCE(player.last_seen_at,player.joined_at,player.updated_at)<v_cutoff)
      ) FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.two_vs_two_players SET connected=false,bot_takeover=true,
      takeover_started_at=now(),takeover_expires_at=NULL,updated_at=now()
    WHERE id=v_player.id AND bot_takeover=false AND abandoned=false
      AND ((connected=false AND COALESCE(takeover_expires_at,
        COALESCE(last_seen_at,joined_at,updated_at)+interval '60 seconds')<=now())
        OR (connected=true AND COALESCE(last_seen_at,joined_at,updated_at)<v_cutoff));
    IF FOUND THEN
      INSERT INTO public.two_vs_two_moves(room_id,player_id,sequence,action,payload)
      VALUES(p_room_id,v_player.user_id,public.next_two_vs_two_move_sequence(p_room_id),
        'takeover_started',jsonb_build_object('player_index',v_player.player_index,
          'user_id',v_player.user_id,'reason','heartbeat_timeout',
          'grace_seconds',GREATEST(p_grace_seconds,60)));
      v_taken:=v_taken+1;
    END IF;
  END LOOP;
  RETURN v_taken;
END;
$$;

REVOKE ALL ON FUNCTION public.process_one_vs_one_room_takeovers(uuid,integer)
FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.process_two_vs_two_room_takeovers(uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_one_vs_one_room_takeovers(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_two_vs_two_room_takeovers(uuid,integer) TO service_role;
