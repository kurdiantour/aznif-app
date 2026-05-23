-- Migration: Game initialization and startup

CREATE OR REPLACE FUNCTION public.start_game(p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.game_rooms%ROWTYPE;
  v_player_count int;
  v_mode text;
  v_result jsonb;
  v_initial_state jsonb;
  v_hands jsonb;
  v_boneyard jsonb;
  v_leading_player_index int := NULL;
  v_current_turn_player_id uuid;
  v_leader_player_id uuid;
  v_shuffled_dominoes jsonb[];
  v_hand1 jsonb := '[]'::jsonb;
  v_hand2 jsonb := '[]'::jsonb;
  v_hand3 jsonb := '[]'::jsonb;
  v_hand4 jsonb := '[]'::jsonb;
  v_opening_double int := NULL;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_room
  FROM public.game_rooms
  WHERE id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF v_room.status NOT IN ('waiting', 'active') THEN
    RAISE EXCEPTION 'Room is not in a valid state to start';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.game_players
    WHERE game_id = p_game_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'You are not a player in this room';
  END IF;

  SELECT COUNT(*) INTO v_player_count
  FROM public.game_players
  WHERE game_id = p_game_id AND user_id IS NOT NULL;

  IF v_player_count < v_room.max_players THEN
    RAISE EXCEPTION 'Not all players present yet';
  END IF;

  v_mode := v_room.mode;

  IF v_room.state ? 'hands' THEN
    RETURN jsonb_build_object(
      'status', 'success',
      'message', 'Game already started',
      'game_id', p_game_id,
      'mode', v_mode
    );
  END IF;

  SELECT array_agg(jsonb_build_object(
      'id', l || '-' || r,
      'left', l,
      'right', r,
      'imageKey', l || '-' || r
    ) ORDER BY random())
  INTO v_shuffled_dominoes
  FROM generate_series(0, 6) AS l
  CROSS JOIN generate_series(l, 6) AS r
  WHERE NOT (v_mode = '1v1' AND l = 0 AND r = 0);

  IF v_mode = '1v1' THEN
    SELECT
      COALESCE(jsonb_agg(domino) FILTER (WHERE idx BETWEEN 1 AND 9), '[]'::jsonb),
      COALESCE(jsonb_agg(domino) FILTER (WHERE idx BETWEEN 10 AND 18), '[]'::jsonb),
      COALESCE(jsonb_agg(domino) FILTER (WHERE idx > 18), '[]'::jsonb)
    INTO v_hand1, v_hand2, v_boneyard
    FROM unnest(v_shuffled_dominoes) WITH ORDINALITY AS x(domino, idx);

    v_hands := jsonb_build_array(v_hand1, v_hand2);
  ELSE
    SELECT
      COALESCE(jsonb_agg(domino) FILTER (WHERE idx BETWEEN 1 AND 7), '[]'::jsonb),
      COALESCE(jsonb_agg(domino) FILTER (WHERE idx BETWEEN 8 AND 14), '[]'::jsonb),
      COALESCE(jsonb_agg(domino) FILTER (WHERE idx BETWEEN 15 AND 21), '[]'::jsonb),
      COALESCE(jsonb_agg(domino) FILTER (WHERE idx BETWEEN 22 AND 28), '[]'::jsonb)
    INTO v_hand1, v_hand2, v_hand3, v_hand4
    FROM unnest(v_shuffled_dominoes) WITH ORDINALITY AS x(domino, idx);

    v_hands := jsonb_build_array(v_hand1, v_hand2, v_hand3, v_hand4);
    v_boneyard := '[]'::jsonb;
  END IF;

  -- Kozel opening rule:
  -- highest available double starts: 6-6, then 5-5, then 4-4...
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

  -- Safety fallback: if no double is in any player's hand, player_index 0 starts.
  IF v_leading_player_index IS NULL THEN
    v_leading_player_index := 0;
  END IF;

  SELECT user_id INTO v_current_turn_player_id
  FROM public.game_players
  WHERE game_id = p_game_id AND player_index = v_leading_player_index
  LIMIT 1;

  v_leader_player_id := v_current_turn_player_id;

  v_initial_state := jsonb_build_object(
    'mode', v_mode,
    'status', 'started',
    'hands', v_hands,
    'boneyard', v_boneyard,
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
    'leaderPlayerId', v_leader_player_id,
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
    'lastPassedPlayerId', NULL
  );

  UPDATE public.game_rooms
  SET 
    status = 'active',
    state = v_initial_state,
    current_turn_player_id = v_current_turn_player_id,
    updated_at = now(),
    version = version + 1
  WHERE id = p_game_id;

  INSERT INTO public.game_moves (
    game_id,
    player_id,
    sequence,
    action,
    payload
  ) VALUES (
    p_game_id,
    v_user_id,
    public.next_game_move_sequence(p_game_id),
    'game_started',
    jsonb_build_object(
      'mode', v_mode,
      'leading_player', v_leading_player_index,
      'opening_double', v_opening_double,
      'timestamp', now()
    )
  );

  v_result := jsonb_build_object(
    'status', 'success',
    'message', 'Game started successfully',
    'game_id', p_game_id,
    'mode', v_mode,
    'opening_double', v_opening_double
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_game(uuid) TO authenticated;