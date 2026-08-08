-- Manual leave no longer cancels or finishes an active match immediately.
-- It marks the player for bot takeover; forfeits are resolved only after a
-- round has completed and the player/team has not returned.

CREATE OR REPLACE FUNCTION public.leave_one_vs_one_match(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
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

  SELECT * INTO v_player
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a player in this 1v1 room';
  END IF;

  IF v_room.status = 'active' THEN
    UPDATE public.one_vs_one_players
    SET connected = false,
        left_at = now(),
        bot_takeover = true,
        takeover_started_at = now(),
        takeover_expires_at = NULL,
        abandoned = false,
        updated_at = now()
    WHERE id = v_player.id;

    INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
    VALUES (
      p_room_id,
      v_user_id,
      public.next_one_vs_one_move_sequence(p_room_id),
      'manual_leave_takeover',
      jsonb_build_object('reason', 'manual_leave_takeover', 'user_id', v_user_id)
    );

    RETURN jsonb_build_object('status', 'bot_takeover', 'room_id', p_room_id);
  END IF;

  UPDATE public.one_vs_one_players
  SET connected = false,
      left_at = now(),
      updated_at = now()
  WHERE id = v_player.id;

  UPDATE public.one_vs_one_rooms
  SET status = 'cancelled',
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id
    AND status = 'waiting';

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    'room_cancelled',
    jsonb_build_object('reason', 'leave_before_start', 'user_id', v_user_id)
  );

  RETURN jsonb_build_object('status', 'left', 'room_id', p_room_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.leave_two_vs_two_match(p_room_id uuid)
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  SELECT * INTO v_player
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a player in this 2v2 room';
  END IF;

  IF v_room.status = 'active' THEN
    UPDATE public.two_vs_two_players
    SET connected = false,
        left_at = now(),
        bot_takeover = true,
        takeover_started_at = now(),
        takeover_expires_at = NULL,
        abandoned = false,
        updated_at = now()
    WHERE id = v_player.id;

    INSERT INTO public.two_vs_two_moves(room_id, player_id, sequence, action, payload)
    VALUES (
      p_room_id,
      v_user_id,
      public.next_two_vs_two_move_sequence(p_room_id),
      'manual_leave_takeover',
      jsonb_build_object('reason', 'manual_leave_takeover', 'user_id', v_user_id, 'team_id', v_player.team_id)
    );

    RETURN jsonb_build_object('status', 'bot_takeover', 'room_id', p_room_id);
  END IF;

  UPDATE public.two_vs_two_players
  SET connected = false,
      left_at = now(),
      updated_at = now()
  WHERE id = v_player.id;

  INSERT INTO public.two_vs_two_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_user_id,
    public.next_two_vs_two_move_sequence(p_room_id),
    'left_before_start',
    jsonb_build_object('reason', 'leave_before_start', 'user_id', v_user_id, 'team_id', v_player.team_id)
  );

  RETURN jsonb_build_object('status', 'left', 'room_id', p_room_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.resolve_one_vs_one_round_leave_forfeits(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
  v_winning_team text;
  v_state jsonb;
BEGIN
  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  SELECT * INTO v_player
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND bot_takeover = true
    AND connected = false
    AND abandoned = false
  ORDER BY takeover_started_at ASC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  v_winning_team := CASE WHEN v_player.team_id = 'teamA' THEN 'teamB' ELSE 'teamA' END;
  v_state := COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object(
      'winningTeamId', v_winning_team,
      'forfeitByPlayerId', v_player.user_id,
      'forfeitReason', 'left_until_round_end',
      'canDrawTile', false
    );

  UPDATE public.one_vs_one_players
  SET abandoned = true,
      connected = false,
      bot_takeover = true,
      updated_at = now()
  WHERE id = v_player.id;

  UPDATE public.one_vs_one_rooms
  SET status = 'finished',
      state = v_state,
      current_turn_player_id = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_player.user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    'round_end_leave_forfeit',
    jsonb_build_object('user_id', v_player.user_id, 'team_id', v_player.team_id, 'winner_team', v_winning_team)
  );

  RETURN jsonb_build_object('forfeit', true, 'winner_team', v_winning_team);
END;
$$;
CREATE OR REPLACE FUNCTION public.resolve_two_vs_two_round_leave_forfeits(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_team_a_left boolean := false;
  v_team_b_left boolean := false;
  v_winning_team text;
  v_losing_team text;
  v_state jsonb;
BEGIN
  SELECT * INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  SELECT COUNT(*) > 0
     AND COUNT(*) = COUNT(*) FILTER (WHERE bot_takeover = true AND connected = false AND abandoned = false)
  INTO v_team_a_left
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id AND team_id = 'teamA';

  SELECT COUNT(*) > 0
     AND COUNT(*) = COUNT(*) FILTER (WHERE bot_takeover = true AND connected = false AND abandoned = false)
  INTO v_team_b_left
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id AND team_id = 'teamB';

  IF v_team_a_left THEN
    v_losing_team := 'teamA';
    v_winning_team := 'teamB';
  ELSIF v_team_b_left THEN
    v_losing_team := 'teamB';
    v_winning_team := 'teamA';
  ELSE
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  v_state := COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object(
      'winningTeamId', v_winning_team,
      'forfeitReason', 'team_left_until_round_end',
      'canDrawTile', false
    );

  UPDATE public.two_vs_two_players
  SET abandoned = true,
      connected = false,
      bot_takeover = true,
      updated_at = now()
  WHERE room_id = p_room_id
    AND team_id = v_losing_team
    AND bot_takeover = true
    AND connected = false
    AND abandoned = false;

  UPDATE public.two_vs_two_rooms
  SET status = 'finished',
      state = v_state,
      current_turn_player_id = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO public.two_vs_two_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    NULL,
    public.next_two_vs_two_move_sequence(p_room_id),
    'round_end_team_leave_forfeit',
    jsonb_build_object('losing_team', v_losing_team, 'winner_team', v_winning_team)
  );

  RETURN jsonb_build_object('forfeit', true, 'winner_team', v_winning_team, 'losing_team', v_losing_team);
END;
$$;
GRANT EXECUTE ON FUNCTION public.leave_one_vs_one_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_two_vs_two_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_two_vs_two_round_leave_forfeits(uuid) TO authenticated;
