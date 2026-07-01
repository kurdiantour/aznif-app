-- In active 2v2 matches, manual leavers remain bot-controlled through the
-- current round. The match ends only when both humans on one team have left.

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

    INSERT INTO public.two_vs_two_moves (
      room_id, player_id, sequence, action, payload
    ) VALUES (
      p_room_id,
      v_user_id,
      public.next_two_vs_two_move_sequence(p_room_id),
      'manual_leave_takeover',
      jsonb_build_object(
        'reason', 'manual_leave_takeover',
        'user_id', v_user_id,
        'team_id', v_player.team_id,
        'player_index', v_player.player_index
      )
    );

    -- If the second teammate leaves during the result presentation, finish
    -- immediately so the next-hand countdown cannot deal another round.
    IF NULLIF(v_room.state ->> 'roundWinnerPlayerId', '') IS NOT NULL THEN
      PERFORM public.resolve_two_vs_two_round_leave_forfeits(p_room_id);
    END IF;

    RETURN jsonb_build_object('status', 'bot_takeover', 'room_id', p_room_id);
  END IF;

  UPDATE public.two_vs_two_players
  SET connected = false, left_at = now(), updated_at = now()
  WHERE id = v_player.id;

  INSERT INTO public.two_vs_two_moves (
    room_id, player_id, sequence, action, payload
  ) VALUES (
    p_room_id,
    v_user_id,
    public.next_two_vs_two_move_sequence(p_room_id),
    'left_before_start',
    jsonb_build_object(
      'reason', 'leave_before_start',
      'user_id', v_user_id,
      'team_id', v_player.team_id
    )
  );

  RETURN jsonb_build_object('status', 'left', 'room_id', p_room_id);
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
            FROM public.two_vs_two_moves AS leave_move
            WHERE leave_move.room_id = p_room_id
              AND leave_move.player_id = member.user_id
              AND leave_move.action = 'manual_leave_takeover'
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
      'forfeitReason', 'team_manual_leave_after_round',
      'finishReason', 'opponent_team_manual_leave',
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
    AND abandoned = false;

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
      'reason', 'team_manual_leave_after_round'
    )
  );

  PERFORM public.settle_finished_match_rewards('2v2', p_room_id);

  RETURN jsonb_build_object(
    'forfeit', true,
    'winner_team', v_winning_team,
    'losing_team', v_losing_team,
    'reason', 'team_manual_leave_after_round'
  );
END;
$$;

-- Manual leave is final for this match; late heartbeats or reopening the
-- screen must not silently restore human control.
CREATE OR REPLACE FUNCTION public.two_vs_two_player_heartbeat(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.two_vs_two_rooms%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_room FROM public.two_vs_two_rooms
  WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '2v2 room not found'; END IF;
  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('status', 'room_not_active', 'room_id', p_room_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.two_vs_two_moves
    WHERE room_id = p_room_id
      AND player_id = v_user_id
      AND action = 'manual_leave_takeover'
  ) THEN
    RETURN jsonb_build_object('status', 'manual_leave_locked', 'room_id', p_room_id);
  END IF;

  UPDATE public.two_vs_two_players
  SET connected = true, bot_takeover = false,
      takeover_started_at = NULL, takeover_expires_at = NULL,
      last_seen_at = now(), left_at = NULL, updated_at = now()
  WHERE room_id = p_room_id AND user_id = v_user_id AND abandoned = false;

  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active player in this 2v2 room'; END IF;
  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_two_vs_two_human_control(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.two_vs_two_rooms%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_room FROM public.two_vs_two_rooms
  WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '2v2 room not found'; END IF;
  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('status', 'room_not_active', 'room_id', p_room_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.two_vs_two_moves
    WHERE room_id = p_room_id
      AND player_id = v_user_id
      AND action = 'manual_leave_takeover'
  ) THEN
    RETURN jsonb_build_object('status', 'manual_leave_locked', 'room_id', p_room_id);
  END IF;

  UPDATE public.two_vs_two_players
  SET connected = true, bot_takeover = false,
      takeover_started_at = NULL, takeover_expires_at = NULL,
      last_seen_at = now(), left_at = NULL, updated_at = now()
  WHERE room_id = p_room_id AND user_id = v_user_id AND abandoned = false;

  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active player in this 2v2 room'; END IF;
  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_two_vs_two_round_leave_forfeits(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.leave_two_vs_two_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.two_vs_two_player_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_two_vs_two_human_control(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_two_vs_two_round_leave_forfeits(uuid)
TO service_role;
