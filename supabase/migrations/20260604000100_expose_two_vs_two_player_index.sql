CREATE OR REPLACE FUNCTION public.get_two_vs_two_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_game_state public.two_vs_two_game_states%ROWTYPE;
  v_private public.two_vs_two_private_states%ROWTYPE;
  v_player_index int;
  v_hand jsonb := '[]'::jsonb;
  v_public_state jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT player_index INTO v_player_index
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id AND user_id = v_user_id;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'You are not a player in this 2v2 room';
  END IF;

  SELECT * INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  SELECT * INTO v_game_state
  FROM public.two_vs_two_game_states
  WHERE room_id = p_room_id;

  IF FOUND THEN
    v_public_state := COALESCE(v_game_state.state, '{}'::jsonb);
  ELSE
    v_public_state := COALESCE(v_room.state, '{}'::jsonb);
  END IF;

  SELECT * INTO v_private
  FROM public.two_vs_two_private_states
  WHERE room_id = p_room_id;

  IF FOUND THEN
    v_hand := COALESCE(v_private.hands -> v_player_index, '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'id', v_room.id,
    'status', v_room.status,
    'version', GREATEST(v_room.version, COALESCE(v_game_state.version, 0)),
    'current_turn_player_id', v_room.current_turn_player_id,
    'myPlayerIndex', v_player_index,
    'state', v_public_state || jsonb_build_object('myHand', v_hand)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_two_vs_two_snapshot(uuid) TO authenticated;
