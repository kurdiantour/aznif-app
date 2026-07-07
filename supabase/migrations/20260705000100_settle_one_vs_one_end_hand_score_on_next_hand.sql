-- Apply empty-hand/blocked hand points only after the reveal window, when the
-- client asks to advance to the next hand.
DO $$
DECLARE
  function_definition text;
  patched_definition text;
BEGIN
  SELECT pg_get_functiondef('public.start_one_vs_one_game(uuid)'::regprocedure)
  INTO function_definition;

  patched_definition := function_definition;

  patched_definition := replace(
    patched_definition,
    'v_has_playable_existing_hand boolean := false;',
    'v_has_playable_existing_hand boolean := false;
  v_settled_team_scores jsonb;
  v_pending_end_score jsonb;
  v_pending_team text;
  v_pending_points int := 0;
  v_winning_team text := NULL;
  v_match_reward jsonb := NULL;
  v_winner_score int := 0;
  v_loser_score int := 0;'
  );

  patched_definition := replace(
    patched_definition,
    'v_has_playable_existing_hand :=',
    'v_settled_team_scores := COALESCE(v_room.state -> ''teamScores'', jsonb_build_object(''teamA'', 0, ''teamB'', 0));

  IF v_is_next_hand AND COALESCE((v_room.state ->> ''endOfHandScoreApplied'')::boolean, false) = false THEN
    v_pending_end_score := v_room.state -> ''endOfHandScoringEvent'';
    v_pending_team := v_pending_end_score ->> ''teamId'';
    v_pending_points := COALESCE((v_pending_end_score ->> ''points'')::int, 0);

    IF v_pending_team IN (''teamA'', ''teamB'') AND v_pending_points > 0 THEN
      v_settled_team_scores := jsonb_set(
        v_settled_team_scores,
        ARRAY[v_pending_team],
        to_jsonb(COALESCE((v_settled_team_scores ->> v_pending_team)::int, 0) + v_pending_points),
        true
      );
    END IF;

    IF COALESCE((v_settled_team_scores ->> ''teamA'')::int, 0) >= 350
       OR COALESCE((v_settled_team_scores ->> ''teamB'')::int, 0) >= 350 THEN
      IF COALESCE((v_settled_team_scores ->> ''teamA'')::int, 0)
         > COALESCE((v_settled_team_scores ->> ''teamB'')::int, 0) THEN
        v_winning_team := ''teamA'';
      ELSIF COALESCE((v_settled_team_scores ->> ''teamB'')::int, 0)
         > COALESCE((v_settled_team_scores ->> ''teamA'')::int, 0) THEN
        v_winning_team := ''teamB'';
      END IF;
    END IF;

    IF v_winning_team IS NOT NULL THEN
      v_winner_score := COALESCE((v_settled_team_scores ->> v_winning_team)::int, 0);
      v_loser_score := CASE
        WHEN v_winning_team = ''teamA'' THEN COALESCE((v_settled_team_scores ->> ''teamB'')::int, 0)
        ELSE COALESCE((v_settled_team_scores ->> ''teamA'')::int, 0)
      END;

      SELECT jsonb_build_object(''tier'', tier, ''gold'', gold, ''points'', points)
      INTO v_match_reward
      FROM public.calculate_match_reward(v_winner_score, v_loser_score);

      UPDATE public.one_vs_one_rooms
      SET status = ''finished'',
          state = v_room.state
            || jsonb_build_object(
              ''teamScores'', v_settled_team_scores,
              ''winningTeamId'', v_winning_team,
              ''matchReward'', v_match_reward,
              ''endOfHandScoreApplied'', true
            ),
          current_turn_player_id = NULL,
          version = version + 1,
          updated_at = now()
      WHERE id = p_room_id;

      RETURN jsonb_build_object(
        ''status'', ''match_finished'',
        ''room_id'', p_room_id,
        ''winningTeamId'', v_winning_team,
        ''started_next_hand'', false
      );
    END IF;
  END IF;

  v_has_playable_existing_hand :='
  );

  patched_definition := replace(
    patched_definition,
    '''teamScores'', COALESCE(v_room.state -> ''teamScores'', jsonb_build_object(''teamA'', 0, ''teamB'', 0)),',
    '''teamScores'', v_settled_team_scores,
    ''endOfHandScoreApplied'', CASE WHEN v_is_next_hand THEN true ELSE false END,'
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'Unable to patch start_one_vs_one_game end-hand settlement';
  END IF;

  EXECUTE patched_definition;
END;
$$;
