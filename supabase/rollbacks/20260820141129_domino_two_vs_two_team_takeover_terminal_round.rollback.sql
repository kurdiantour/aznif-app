-- Roll back only the 2v2 team-takeover terminal-round migration.
DROP TRIGGER IF EXISTS trg_finalize_two_vs_two_takeover_after_round
ON public.two_vs_two_rooms;
DROP FUNCTION IF EXISTS public.finalize_two_vs_two_takeover_after_round();

CREATE OR REPLACE FUNCTION public.apply_two_vs_two_timeout_strike_takeover(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.two_vs_two_players
  SET bot_takeover = true,
      connected = false,
      abandoned = false,
      takeover_started_at = now(),
      takeover_expires_at = NULL,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND bot_takeover = false;

  IF FOUND THEN
    PERFORM public.check_and_finalize_zero_human_room('2v2', p_room_id);
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.resolve_two_vs_two_round_leave_forfeits(
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_losing_team text;
  v_winning_team text;
  v_winner_score integer;
  v_loser_score integer;
  v_reward record;
  v_state jsonb;
BEGIN
  SELECT * INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  IF v_room.status <> 'active'
    OR NULLIF(v_room.state ->> 'roundWinnerPlayerId', '') IS NULL
  THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  -- A team forfeits when EVERY member on that team is bot-controlled
  -- and disconnected (regardless of reason: manual leave, disconnect
  -- timeout, or consecutive timeout-strike takeover).
  SELECT team.team_id INTO v_losing_team
  FROM (VALUES ('teamA'), ('teamB')) AS team(team_id)
  WHERE EXISTS (
      SELECT 1 FROM public.two_vs_two_players AS member
      WHERE member.room_id = p_room_id AND member.team_id = team.team_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.two_vs_two_players AS member
      WHERE member.room_id = p_room_id
        AND member.team_id = team.team_id
        AND NOT (
          member.bot_takeover = true
          AND member.connected = false
          AND member.abandoned = false
      AND EXISTS (
        SELECT 1
        FROM public.two_vs_two_moves AS ml
        WHERE ml.room_id = member.room_id
          AND ml.player_id = member.user_id
          AND ml.action = 'manual_leave_takeover'
      )
        )
    )
  ORDER BY team.team_id
  LIMIT 1;

  IF v_losing_team IS NULL THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  v_winning_team := CASE
    WHEN v_losing_team = 'teamA' THEN 'teamB'
    ELSE 'teamA'
  END;
  v_winner_score := COALESCE(
    (v_room.state #>> ARRAY['teamScores', v_winning_team])::integer,
    0
  );
  v_loser_score := COALESCE(
    (v_room.state #>> ARRAY['teamScores', v_losing_team])::integer,
    0
  );

  SELECT * INTO v_reward
  FROM public.calculate_match_reward(v_winner_score, v_loser_score);

  v_state := COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object(
      'winningTeamId', v_winning_team,
      'forfeitTeamId', v_losing_team,
      'forfeitReason', 'team_not_human_controlled_after_round',
      'finishReason', 'opponent_team_not_human_controlled',
      'matchReward', jsonb_build_object(
        'tier', v_reward.tier,
        'gold', v_reward.gold,
        'points', v_reward.points
      ),
      'canDrawTile', false
    );

  UPDATE public.two_vs_two_players
  SET abandoned = true, connected = false, updated_at = now()
  WHERE room_id = p_room_id
    AND team_id = v_losing_team
    AND bot_takeover = true
    AND connected = false
    AND abandoned = false
      AND EXISTS (
        SELECT 1
        FROM public.two_vs_two_moves AS ml
        WHERE ml.room_id = p_room_id
          AND ml.player_id = user_id
          AND ml.action = 'manual_leave_takeover'
      );

  UPDATE public.two_vs_two_rooms
  SET status = 'finished',
      state = v_state,
      current_turn_player_id = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO public.two_vs_two_moves (
    room_id, player_id, sequence, action, payload
  ) VALUES (
    p_room_id,
    NULL,
    public.next_two_vs_two_move_sequence(p_room_id),
    'round_end_team_leave_forfeit',
    jsonb_build_object(
      'losing_team', v_losing_team,
      'winner_team', v_winning_team,
      'reason', 'team_not_human_controlled_after_round'
    )
  );

  PERFORM public.settle_finished_match_rewards('2v2', p_room_id);

  RETURN jsonb_build_object(
    'forfeit', true,
    'winner_team', v_winning_team,
    'losing_team', v_losing_team,
    'reason', 'team_not_human_controlled_after_round'
  );
END;
$$;

