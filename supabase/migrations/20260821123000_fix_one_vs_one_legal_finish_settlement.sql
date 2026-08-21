CREATE OR REPLACE FUNCTION public.start_one_vs_one_game(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_settled_team_scores jsonb;
  v_pending_end_score jsonb;
  v_pending_team text;
  v_pending_points int := 0;
  v_winning_team text := NULL;
  v_match_reward jsonb := NULL;
  v_settlement jsonb := NULL;
  v_winner_score int := 0;
  v_loser_score int := 0;
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
  v_round_winner_player_id := NULLIF(COALESCE(v_room.state ->> 'leaderPlayerId', v_room.state ->> 'roundWinnerPlayerId'), '')::uuid;

  v_settled_team_scores := COALESCE(v_room.state -> 'teamScores', jsonb_build_object('teamA', 0, 'teamB', 0));

  IF v_is_next_hand AND COALESCE((v_room.state ->> 'endOfHandScoreApplied')::boolean, false) = false THEN
    v_pending_end_score := v_room.state -> 'endOfHandScoringEvent';
    v_pending_team := v_pending_end_score ->> 'teamId';
    v_pending_points := COALESCE((v_pending_end_score ->> 'points')::int, 0);

    IF v_pending_team IN ('teamA', 'teamB') AND v_pending_points > 0 THEN
      v_settled_team_scores := jsonb_set(
        v_settled_team_scores,
        ARRAY[v_pending_team],
        to_jsonb(COALESCE((v_settled_team_scores ->> v_pending_team)::int, 0) + v_pending_points),
        true
      );
    END IF;

    IF COALESCE((v_settled_team_scores ->> 'teamA')::int, 0) >= 350
       OR COALESCE((v_settled_team_scores ->> 'teamB')::int, 0) >= 350 THEN
      IF COALESCE((v_settled_team_scores ->> 'teamA')::int, 0)
         > COALESCE((v_settled_team_scores ->> 'teamB')::int, 0) THEN
        v_winning_team := 'teamA';
      ELSIF COALESCE((v_settled_team_scores ->> 'teamB')::int, 0)
         > COALESCE((v_settled_team_scores ->> 'teamA')::int, 0) THEN
        v_winning_team := 'teamB';
      END IF;
    END IF;

    IF v_winning_team IS NOT NULL THEN
      v_winner_score := COALESCE((v_settled_team_scores ->> v_winning_team)::int, 0);
      v_loser_score := CASE
        WHEN v_winning_team = 'teamA' THEN COALESCE((v_settled_team_scores ->> 'teamB')::int, 0)
        ELSE COALESCE((v_settled_team_scores ->> 'teamA')::int, 0)
      END;

      SELECT jsonb_build_object('tier', tier, 'gold', gold, 'points', points)
      INTO v_match_reward
      FROM public.calculate_match_reward(v_winner_score, v_loser_score);

      UPDATE public.one_vs_one_rooms
      SET status = 'finished',
          state = v_room.state
            || jsonb_build_object(
              'teamScores', v_settled_team_scores,
              'winningTeamId', v_winning_team,
              'matchReward', v_match_reward,
              'endOfHandScoreApplied', true
            ),
          current_turn_player_id = NULL,
          version = version + 1,
          updated_at = now()
      WHERE id = p_room_id;

      -- Canonical economy settlement must run for a normal/legal match finish too.
      -- Takeover/forfeit paths already do this; the legal Human-vs-Human path
      -- previously stopped after marking the room finished, so the final popup
      -- had no settlement payload to display.
      v_settlement := public.domino_settle_match('1v1', p_room_id);

      RETURN jsonb_build_object(
        'status', 'match_finished',
        'room_id', p_room_id,
        'winningTeamId', v_winning_team,
        'settlement', v_settlement,
        'started_next_hand', false
      );
    END IF;
  END IF;

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
    'turnStartedAt', to_char(
      clock_timestamp() AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'leaderPlayerId', v_current_turn_player_id,
    'openingDouble', CASE WHEN v_is_next_hand THEN NULL ELSE v_opening_double END,
    'openingTileId', CASE WHEN v_is_next_hand OR v_opening_double IS NULL THEN NULL ELSE v_opening_double || '-' || v_opening_double END,
    'isFirstRound', NOT v_is_next_hand,
    'isOpeningRound', NOT v_is_next_hand,
    'spinnerValue', NULL,
    'teamScores', v_settled_team_scores,
    'endOfHandScoreApplied', CASE WHEN v_is_next_hand THEN true ELSE false END,
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
$function$;

NOTIFY pgrst, 'reload schema';

-- Project the canonical room settlement into the 1v1 snapshot consumed by the UI.
-- The room column remains the single source of truth; no duplicate settlement state is persisted.
CREATE OR REPLACE FUNCTION public.get_one_vs_one_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_is_free boolean;
  v_settlement jsonb;
BEGIN
  v_snapshot := public.get_one_vs_one_snapshot_before_free_economy(p_room_id);

  SELECT
    room.bet_amount <= 0
      AND COALESCE(room.metadata ->> 'aznif_betting', 'false') <> 'true',
    room.settlement
  INTO v_is_free, v_settlement
  FROM public.one_vs_one_rooms AS room
  WHERE room.id = p_room_id;

  -- one_vs_one_rooms.settlement is the canonical economy result.
  -- Project it into the snapshot state so existing game UI can consume the
  -- same payload for legal finishes, takeover finishes, and resumed matches.
  IF v_settlement IS NOT NULL THEN
    v_snapshot := jsonb_set(
      v_snapshot,
      '{state}',
      COALESCE(v_snapshot -> 'state', '{}'::jsonb)
        || jsonb_build_object(
          'settlement', v_settlement,
          'onlineMatchResultReward', v_settlement
        ),
      true
    );
  END IF;

  RETURN v_snapshot
    || jsonb_build_object(
      'freeEconomyEligible', COALESCE(v_is_free, false)
    );
END;
$function$;