CREATE OR REPLACE FUNCTION public.start_one_vs_one_game(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_private public.one_vs_one_private_states%ROWTYPE;
  v_player_count int;
  v_initial_state jsonb;
  v_hands jsonb;
  v_boneyard jsonb;
  v_hand1 jsonb := '[]'::jsonb;
  v_hand2 jsonb := '[]'::jsonb;
  v_opening_double int := NULL;
  v_leading_player_index int := 0;
  v_current_turn_player_id uuid;
  v_shuffled_dominoes jsonb[];
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

  IF v_room.status NOT IN ('waiting', 'active') THEN
    RAISE EXCEPTION '1v1 room is not in a valid state to start';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.one_vs_one_players
    WHERE room_id = p_room_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'You are not a player in this 1v1 room';
  END IF;

  SELECT COUNT(*) INTO v_player_count
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id AND user_id IS NOT NULL;

  IF v_player_count < 2 THEN
    RAISE EXCEPTION 'Both 1v1 players must be present';
  END IF;

  SELECT * INTO v_private
  FROM public.one_vs_one_private_states
  WHERE room_id = p_room_id
  FOR UPDATE;

  IF FOUND
     AND jsonb_typeof(COALESCE(v_private.hands, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(v_private.hands, '[]'::jsonb)) >= 2
     AND jsonb_typeof(COALESCE(v_private.hands -> 0, '[]'::jsonb)) = 'array'
     AND jsonb_typeof(COALESCE(v_private.hands -> 1, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(v_private.hands -> 0, '[]'::jsonb)) > 0
     AND jsonb_array_length(COALESCE(v_private.hands -> 1, '[]'::jsonb)) > 0 THEN
    RETURN jsonb_build_object('status', 'success', 'message', '1v1 game already started', 'room_id', p_room_id);
  END IF;

  SELECT array_agg(
    jsonb_build_object('id', l || '-' || r, 'left', l, 'right', r, 'imageKey', l || '-' || r)
    ORDER BY random()
  )
  INTO v_shuffled_dominoes
  FROM generate_series(0, 6) AS l
  CROSS JOIN generate_series(l, 6) AS r
  WHERE NOT (l = 0 AND r = 0);

  SELECT
    COALESCE(jsonb_agg(domino) FILTER (WHERE idx BETWEEN 1 AND 9), '[]'::jsonb),
    COALESCE(jsonb_agg(domino) FILTER (WHERE idx BETWEEN 10 AND 18), '[]'::jsonb),
    COALESCE(jsonb_agg(domino) FILTER (WHERE idx > 18), '[]'::jsonb)
  INTO v_hand1, v_hand2, v_boneyard
  FROM unnest(v_shuffled_dominoes) WITH ORDINALITY AS x(domino, idx);

  v_hands := jsonb_build_array(v_hand1, v_hand2);

  SELECT d INTO v_opening_double
  FROM generate_series(6, 0, -1) AS d
  WHERE v_hands @> jsonb_build_array(jsonb_build_array(jsonb_build_object('left', d, 'right', d)))
     OR v_hands @> jsonb_build_array(jsonb_build_array(jsonb_build_object('id', d || '-' || d)))
  ORDER BY d DESC
  LIMIT 1;

  IF v_opening_double IS NOT NULL THEN
    SELECT idx - 1 INTO v_leading_player_index
    FROM jsonb_array_elements(v_hands) WITH ORDINALITY AS hand(hand_json, idx)
    WHERE hand_json @> jsonb_build_array(jsonb_build_object('left', v_opening_double, 'right', v_opening_double))
       OR hand_json @> jsonb_build_array(jsonb_build_object('id', v_opening_double || '-' || v_opening_double))
    ORDER BY idx ASC
    LIMIT 1;
  END IF;

  SELECT user_id INTO v_current_turn_player_id
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id AND player_index = v_leading_player_index
  LIMIT 1;

  v_initial_state := jsonb_build_object(
    'mode', '1v1',
    'status', 'started',
    'handCounts', jsonb_build_array(jsonb_array_length(v_hand1), jsonb_array_length(v_hand2)),
    'boneyardCount', jsonb_array_length(v_boneyard),
    'board', jsonb_build_object(
      'centerTile', NULL,
      'branches', jsonb_build_object(
        'left', jsonb_build_object('branch', 'left', 'tiles', jsonb_build_array(), 'openValue', NULL, 'blocked', false),
        'right', jsonb_build_object('branch', 'right', 'tiles', jsonb_build_array(), 'openValue', NULL, 'blocked', false),
        'up', jsonb_build_object('branch', 'up', 'tiles', jsonb_build_array(), 'openValue', NULL, 'blocked', false),
        'down', jsonb_build_object('branch', 'down', 'tiles', jsonb_build_array(), 'openValue', NULL, 'blocked', false)
      )
    ),
    'currentTurnPlayerId', v_current_turn_player_id,
    'leaderPlayerId', v_current_turn_player_id,
    'openingDouble', v_opening_double,
    'openingTileId', CASE WHEN v_opening_double IS NULL THEN NULL ELSE v_opening_double || '-' || v_opening_double END,
    'isFirstRound', true,
    'isOpeningRound', true,
    'spinnerValue', NULL,
    'teamScores', jsonb_build_object('teamA', 0, 'teamB', 0),
    'roundWinnerPlayerId', NULL,
    'lastPlayedTile', NULL,
    'canDrawTile', false,
    'matchReward', NULL,
    'winningTeamId', NULL,
    'lastScoringEvent', NULL,
    'lastPassedPlayerId', NULL,
    'blockedPasses', jsonb_build_array()
  );

  INSERT INTO public.one_vs_one_private_states(room_id, hands, boneyard)
  VALUES (p_room_id, v_hands, v_boneyard)
  ON CONFLICT (room_id)
  DO UPDATE SET
    hands = EXCLUDED.hands,
    boneyard = EXCLUDED.boneyard,
    updated_at = now();

  UPDATE public.one_vs_one_rooms
  SET status = 'active',
      state = v_initial_state,
      current_turn_player_id = v_current_turn_player_id,
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    'game_started',
    jsonb_build_object('leading_player_index', v_leading_player_index, 'opening_double', v_opening_double)
  );

  RETURN jsonb_build_object('status', 'success', 'room_id', p_room_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.get_one_vs_one_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_private public.one_vs_one_private_states%ROWTYPE;
  v_player_index int;
  v_hand jsonb := '[]'::jsonb;
  v_hands_length int := 0;
  v_selected_hand_length int := 0;
  v_attempt int := 0;
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

  LOOP
    SELECT *
    INTO v_private
    FROM public.one_vs_one_private_states
    WHERE room_id = p_room_id;

    v_hands_length := 0;
    v_hand := '[]'::jsonb;
    v_selected_hand_length := 0;

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

    EXIT WHEN v_room.status <> 'active';
    EXIT WHEN COALESCE(v_room.state ->> 'status', '') <> 'started';
    EXIT WHEN v_hands_length >= 2 AND v_selected_hand_length > 0;
    EXIT WHEN v_attempt >= 5;

    v_attempt := v_attempt + 1;
    PERFORM pg_sleep(0.1);
  END LOOP;

  IF v_room.status = 'active'
     AND COALESCE(v_room.state ->> 'status', '') = 'started'
     AND (v_hands_length < 2 OR v_selected_hand_length = 0) THEN
    RAISE EXCEPTION '1v1 private state is not ready for active room %: hands_length=%, selected_hand_length=%',
      p_room_id, v_hands_length, v_selected_hand_length;
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
GRANT EXECUTE ON FUNCTION public.start_one_vs_one_game(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_one_vs_one_snapshot(uuid) TO authenticated;
