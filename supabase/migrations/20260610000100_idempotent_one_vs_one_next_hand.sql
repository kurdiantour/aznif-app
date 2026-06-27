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
  v_has_existing_hands boolean := false;
  v_is_next_hand boolean := false;
  v_round_winner_player_id uuid := NULL;
  v_has_playable_existing_hand boolean := false;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.one_vs_one_players
    WHERE room_id = p_room_id AND player_index IN (0, 1)
    GROUP BY room_id
    HAVING COUNT(DISTINCT player_index) = 2
  ) THEN
    RAISE EXCEPTION '1v1 players must occupy player_index 0 and 1';
  END IF;

  SELECT * INTO v_private
  FROM public.one_vs_one_private_states
  WHERE room_id = p_room_id
  FOR UPDATE;

  v_is_next_hand := COALESCE(v_room.state ->> 'roundWinnerPlayerId', '') <> '';
  v_round_winner_player_id := NULLIF(
    COALESCE(
      v_room.state ->> 'leaderPlayerId',
      v_room.state ->> 'roundWinnerPlayerId'
    ),
    ''
  )::uuid;

  v_has_playable_existing_hand :=
    FOUND
    AND COALESCE(v_room.state ->> 'winningTeamId', '') = ''
    AND COALESCE(v_room.state ->> 'roundWinnerPlayerId', '') = ''
    AND COALESCE(v_room.state ->> 'status', '') = 'started'
    AND jsonb_typeof(COALESCE(v_private.hands, '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(v_private.hands, '[]'::jsonb)) >= 2
    AND jsonb_typeof(COALESCE(v_private.hands -> 0, '[]'::jsonb)) = 'array'
    AND jsonb_typeof(COALESCE(v_private.hands -> 1, '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(v_private.hands -> 0, '[]'::jsonb)) > 0
    AND jsonb_array_length(COALESCE(v_private.hands -> 1, '[]'::jsonb)) > 0;

  IF v_room.status = 'active' AND v_has_playable_existing_hand THEN
    RETURN jsonb_build_object(
      'status', 'already_started',
      'room_id', p_room_id,
      'current_turn_player_id', v_room.current_turn_player_id,
      'started_next_hand', false
    );
  END IF;

  v_has_existing_hands :=
    v_has_playable_existing_hand
    AND NOT v_is_next_hand
    AND jsonb_typeof(COALESCE(v_private.hands, '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(v_private.hands, '[]'::jsonb)) >= 2
    AND jsonb_typeof(COALESCE(v_private.hands -> 0, '[]'::jsonb)) = 'array'
    AND jsonb_typeof(COALESCE(v_private.hands -> 1, '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(v_private.hands -> 0, '[]'::jsonb)) > 0
    AND jsonb_array_length(COALESCE(v_private.hands -> 1, '[]'::jsonb)) > 0;

  IF v_has_existing_hands THEN
    v_hands := v_private.hands;
    v_boneyard := COALESCE(v_private.boneyard, '[]'::jsonb);
    v_hand1 := COALESCE(v_hands -> 0, '[]'::jsonb);
    v_hand2 := COALESCE(v_hands -> 1, '[]'::jsonb);
  ELSE
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
  END IF;

  IF v_is_next_hand THEN
    SELECT player_index INTO v_leading_player_index
    FROM public.one_vs_one_players
    WHERE room_id = p_room_id
      AND user_id = v_round_winner_player_id
    LIMIT 1;

    IF v_leading_player_index IS NULL THEN
      v_leading_player_index := 0;
    END IF;
  ELSE
    SELECT
      (tile.tile_json ->> 'left')::int,
      hand.idx - 1
    INTO v_opening_double, v_leading_player_index
    FROM jsonb_array_elements(v_hands) WITH ORDINALITY AS hand(hand_json, idx)
    CROSS JOIN LATERAL jsonb_array_elements(hand.hand_json) AS tile(tile_json)
    WHERE (tile.tile_json ->> 'left')::int = (tile.tile_json ->> 'right')::int
    ORDER BY (tile.tile_json ->> 'left')::int DESC, hand.idx ASC
    LIMIT 1;

    IF v_opening_double IS NULL THEN
      v_leading_player_index := 0;
    END IF;
  END IF;

  SELECT user_id INTO v_current_turn_player_id
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND player_index = v_leading_player_index
  LIMIT 1;

  IF v_current_turn_player_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve opening 1v1 player for index %', v_leading_player_index;
  END IF;

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
    'openingDouble', CASE WHEN v_is_next_hand THEN NULL ELSE v_opening_double END,
    'openingTileId', CASE WHEN v_is_next_hand OR v_opening_double IS NULL THEN NULL ELSE v_opening_double || '-' || v_opening_double END,
    'isFirstRound', NOT v_is_next_hand,
    'isOpeningRound', NOT v_is_next_hand,
    'spinnerValue', NULL,
    'teamScores', COALESCE(v_room.state -> 'teamScores', jsonb_build_object('teamA', 0, 'teamB', 0)),
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
    CASE WHEN v_has_existing_hands THEN 'game_start_turn_corrected' ELSE 'game_started' END,
    jsonb_build_object(
      'leading_player_index', v_leading_player_index,
      'opening_double', CASE WHEN v_is_next_hand THEN NULL ELSE v_opening_double END,
      'current_turn_player_id', v_current_turn_player_id,
      'used_existing_hands', v_has_existing_hands,
      'started_next_hand', v_is_next_hand
    )
  );

  RETURN jsonb_build_object(
    'status', 'success',
    'room_id', p_room_id,
    'leading_player_index', v_leading_player_index,
    'opening_double', CASE WHEN v_is_next_hand THEN NULL ELSE v_opening_double END,
    'current_turn_player_id', v_current_turn_player_id,
    'started_next_hand', v_is_next_hand
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_one_vs_one_game(uuid) TO authenticated;
