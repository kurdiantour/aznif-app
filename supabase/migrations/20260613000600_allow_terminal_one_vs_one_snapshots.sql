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
  v_private_found boolean := false;
  v_player_index int;
  v_hand jsonb := '[]'::jsonb;
  v_hands_length int := 0;
  v_selected_hand_length int := 0;
  v_attempt int := 0;
  v_opening_double int := NULL;
  v_leading_player_index int := NULL;
  v_opening_turn_player_id uuid := NULL;
  v_board jsonb := NULL;
  v_board_empty boolean := false;
  v_corrected_opening_turn boolean := false;
  v_has_round_winner boolean := false;
  v_has_match_winner boolean := false;
  v_is_terminal boolean := false;
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

    v_private_found := FOUND;
    v_hands_length := 0;
    v_hand := '[]'::jsonb;
    v_selected_hand_length := 0;
    v_has_round_winner := COALESCE(v_room.state ->> 'roundWinnerPlayerId', '') <> '';
    v_has_match_winner := COALESCE(v_room.state ->> 'winningTeamId', '') <> '';
    v_is_terminal :=
      v_room.status IN ('finished', 'cancelled')
      OR COALESCE(v_room.state ->> 'status', '') = 'finished'
      OR v_has_match_winner;

    IF v_private_found THEN
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
    EXIT WHEN v_has_round_winner OR v_is_terminal;
    EXIT WHEN v_hands_length >= 2 AND v_selected_hand_length > 0;
    EXIT WHEN v_attempt >= 5;

    v_attempt := v_attempt + 1;
    PERFORM pg_sleep(0.1);
  END LOOP;

  IF v_room.status = 'active'
     AND COALESCE(v_room.state ->> 'status', '') = 'started'
     AND NOT v_has_round_winner
     AND NOT v_is_terminal
     AND (v_hands_length < 2 OR v_selected_hand_length = 0) THEN
    RAISE EXCEPTION '1v1 private state is not ready for active room %: private_found=%, private_room_id=%, hands_length=%, selected_hand_length=%',
      p_room_id, v_private_found, v_private.room_id, v_hands_length, v_selected_hand_length;
  END IF;

  v_board := v_room.state -> 'board';
  v_board_empty :=
    v_board IS NOT NULL
    AND (v_board -> 'centerTile') = 'null'::jsonb
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(COALESCE(v_board -> 'branches', '{}'::jsonb)) AS branch(branch_name, branch_json)
      WHERE jsonb_array_length(COALESCE(branch_json -> 'tiles', '[]'::jsonb)) > 0
    );

  IF v_private_found
     AND v_room.status = 'active'
     AND COALESCE(v_room.state ->> 'status', '') = 'started'
     AND NOT v_has_round_winner
     AND NOT v_is_terminal
     AND COALESCE((v_room.state ->> 'isOpeningRound')::boolean, COALESCE((v_room.state ->> 'isFirstRound')::boolean, true))
     AND v_board_empty THEN
    SELECT
      (tile.tile_json ->> 'left')::int,
      hand.idx - 1
    INTO v_opening_double, v_leading_player_index
    FROM jsonb_array_elements(v_private.hands) WITH ORDINALITY AS hand(hand_json, idx)
    CROSS JOIN LATERAL jsonb_array_elements(hand.hand_json) AS tile(tile_json)
    WHERE (tile.tile_json ->> 'left')::int = (tile.tile_json ->> 'right')::int
    ORDER BY (tile.tile_json ->> 'left')::int DESC, hand.idx ASC
    LIMIT 1;

    IF v_leading_player_index IS NOT NULL THEN
      SELECT user_id
      INTO v_opening_turn_player_id
      FROM public.one_vs_one_players
      WHERE room_id = p_room_id
        AND player_index = v_leading_player_index
      LIMIT 1;
    END IF;

    IF v_opening_turn_player_id IS NOT NULL
       AND (
         v_room.state ->> 'currentTurnPlayerId' IS DISTINCT FROM v_opening_turn_player_id::text
         OR v_room.state ->> 'leaderPlayerId' IS DISTINCT FROM v_opening_turn_player_id::text
         OR v_room.current_turn_player_id IS DISTINCT FROM v_opening_turn_player_id
       ) THEN
      UPDATE public.one_vs_one_rooms
      SET state = v_room.state || jsonb_build_object(
            'currentTurnPlayerId', v_opening_turn_player_id,
            'leaderPlayerId', v_opening_turn_player_id,
            'openingDouble', v_opening_double,
            'openingTileId', CASE WHEN v_opening_double IS NULL THEN NULL ELSE v_opening_double || '-' || v_opening_double END
          ),
          current_turn_player_id = v_opening_turn_player_id,
          version = version + 1,
          updated_at = now()
      WHERE id = p_room_id
      RETURNING * INTO v_room;

      v_corrected_opening_turn := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_room.id,
    'status', v_room.status,
    'version', v_room.version,
    'current_turn_player_id', v_room.current_turn_player_id,
    'myPlayerIndex', v_player_index,
    'debugRpcVersion', '20260613_28_ALLOW_TERMINAL_EMPTY_HAND',
    'debugAuthUserId', v_user_id,
    'debugDbCurrentUser', current_user,
    'debugDbSessionUser', session_user,
    'debugPlayerIndex', v_player_index,
    'debugRoomStatus', v_room.status,
    'debugPrivateStateFound', v_private_found,
    'debugPrivateRoomId', v_private.room_id,
    'debugPrivateHandsRaw', CASE WHEN v_private_found THEN v_private.hands ELSE NULL END,
    'debugHandsLength', v_hands_length,
    'debugSelectedHandLength', v_selected_hand_length,
    'debugOpeningDouble', v_opening_double,
    'debugOpeningPlayerIndex', v_leading_player_index,
    'debugOpeningTurnPlayerId', v_opening_turn_player_id,
    'debugCorrectedOpeningTurn', v_corrected_opening_turn,
    'state', v_room.state || jsonb_build_object('myHand', v_hand)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_one_vs_one_snapshot(uuid) TO authenticated;
