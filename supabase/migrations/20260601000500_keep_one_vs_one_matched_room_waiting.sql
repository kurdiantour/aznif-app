CREATE OR REPLACE FUNCTION public.find_one_vs_one_opponent()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_opponent public.one_vs_one_matchmaking_queue%ROWTYPE;
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_seat text;
  v_team text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM public.one_vs_one_matchmaking_queue
  WHERE user_id = v_user_id
     OR (status = 'searching' AND created_at < now() - interval '5 minutes');

  SELECT *
  INTO v_opponent
  FROM public.one_vs_one_matchmaking_queue
  WHERE status = 'searching'
    AND user_id <> v_user_id
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    INSERT INTO public.one_vs_one_rooms (
      host_user_id,
      room_code,
      status,
      bet_amount,
      player_count
    ) VALUES (
      v_user_id,
      public.generate_one_vs_one_room_code(),
      'waiting',
      0,
      2
    )
    RETURNING * INTO v_room;

    SELECT seat, team_id INTO v_seat, v_team
    FROM public.resolve_one_vs_one_seat_assignment(0);

    INSERT INTO public.one_vs_one_players (
      room_id, user_id, kind, seat, team_id, player_index, is_ready, connected
    ) VALUES (
      v_room.id, v_opponent.user_id, 'human', v_seat, v_team, 0, true, true
    );

    SELECT seat, team_id INTO v_seat, v_team
    FROM public.resolve_one_vs_one_seat_assignment(1);

    INSERT INTO public.one_vs_one_players (
      room_id, user_id, kind, seat, team_id, player_index, is_ready, connected
    ) VALUES (
      v_room.id, v_user_id, 'human', v_seat, v_team, 1, true, true
    );

    UPDATE public.one_vs_one_matchmaking_queue
    SET status = 'matched',
        matched_room_id = v_room.id,
        ended_at = now()
    WHERE user_id = v_opponent.user_id;

    INSERT INTO public.one_vs_one_matchmaking_queue (
      user_id,
      status,
      matched_room_id,
      ended_at
    ) VALUES (
      v_user_id,
      'matched',
      v_room.id,
      now()
    );

    INSERT INTO public.one_vs_one_moves (
      room_id, player_id, sequence, action, payload
    ) VALUES (
      v_room.id,
      v_user_id,
      public.next_one_vs_one_move_sequence(v_room.id),
      'match_created',
      jsonb_build_object('player_1', v_opponent.user_id, 'player_2', v_user_id)
    );

    RETURN jsonb_build_object(
      'status', 'matched',
      'room_id', v_room.id,
      'room_code', v_room.room_code,
      'opponent_user_id', v_opponent.user_id
    );
  END IF;

  INSERT INTO public.one_vs_one_matchmaking_queue (user_id, status)
  VALUES (v_user_id, 'searching');

  RETURN jsonb_build_object('status', 'searching');
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_one_vs_one_opponent() TO authenticated;