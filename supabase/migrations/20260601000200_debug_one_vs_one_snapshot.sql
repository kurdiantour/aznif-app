CREATE OR REPLACE FUNCTION public.get_one_vs_one_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_private public.one_vs_one_private_states%ROWTYPE;
  v_player_index int;
  v_hand jsonb := '[]'::jsonb;
  v_hands_length int := 0;
  v_selected_hand_length int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT player_index
  INTO v_player_index
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND user_id = v_user_id;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'You are not a player in this 1v1 room';
  END IF;

  SELECT *
  INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  SELECT *
  INTO v_private
  FROM public.one_vs_one_private_states
  WHERE room_id = p_room_id;

  IF FOUND THEN
    v_hands_length := jsonb_array_length(COALESCE(v_private.hands, '[]'::jsonb));
    v_hand := COALESCE(v_private.hands -> v_player_index, '[]'::jsonb);
    v_selected_hand_length := jsonb_array_length(
      CASE
        WHEN jsonb_typeof(v_hand) = 'array' THEN v_hand
        ELSE '[]'::jsonb
      END
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_room.id,
    'status', v_room.status,
    'version', v_room.version,
    'current_turn_player_id', v_room.current_turn_player_id,
    'myPlayerIndex', v_player_index,
    'debugAuthUserId', v_user_id,
    'debugPlayerIndex', v_player_index,
    'debugHandsLength', v_hands_length,
    'debugSelectedHandLength', v_selected_hand_length,
    'state', v_room.state || jsonb_build_object('myHand', v_hand)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_one_vs_one_snapshot(uuid) TO authenticated;
