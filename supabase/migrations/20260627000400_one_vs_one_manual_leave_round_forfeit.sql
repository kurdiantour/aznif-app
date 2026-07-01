-- In active 1v1 matches, a manual leave is handled by a bot only until the
-- current round ends. The human opponent then wins the match by forfeit.
-- This migration intentionally comes after the reconnect-grace migration so
-- this is the final definition of leave_one_vs_one_match.

CREATE OR REPLACE FUNCTION public.leave_one_vs_one_match(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
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

  SELECT * INTO v_player
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a player in this 1v1 room';
  END IF;

  IF v_room.status = 'active' THEN
    UPDATE public.one_vs_one_players
    SET connected = false,
        left_at = now(),
        bot_takeover = true,
        takeover_started_at = now(),
        takeover_expires_at = NULL,
        abandoned = false,
        updated_at = now()
    WHERE id = v_player.id;

    INSERT INTO public.one_vs_one_moves (
      room_id,
      player_id,
      sequence,
      action,
      payload
    ) VALUES (
      p_room_id,
      v_user_id,
      public.next_one_vs_one_move_sequence(p_room_id),
      'manual_leave_takeover',
      jsonb_build_object(
        'reason', 'manual_leave_takeover',
        'user_id', v_user_id,
        'player_index', v_player.player_index
      )
    );

    -- The round may already have ended while its result animation is being
    -- shown. Resolve now so the next round cannot start in that race window.
    IF NULLIF(v_room.state ->> 'roundWinnerPlayerId', '') IS NOT NULL THEN
      PERFORM public.resolve_one_vs_one_round_leave_forfeits(p_room_id);
    END IF;

    RETURN jsonb_build_object(
      'status', 'bot_takeover',
      'room_id', p_room_id
    );
  END IF;

  UPDATE public.one_vs_one_players
  SET connected = false,
      left_at = now(),
      updated_at = now()
  WHERE id = v_player.id;

  UPDATE public.one_vs_one_rooms
  SET status = 'cancelled',
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id
    AND status = 'waiting';

  RETURN jsonb_build_object('status', 'left', 'room_id', p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_one_vs_one_round_leave_forfeits(
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_leaver public.one_vs_one_players%ROWTYPE;
  v_winning_team text;
  v_winner_score integer;
  v_loser_score integer;
  v_reward record;
  v_state jsonb;
BEGIN
  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.status <> 'active'
    OR NULLIF(v_room.state ->> 'roundWinnerPlayerId', '') IS NULL
  THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  SELECT * INTO v_leaver
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND bot_takeover = true
    AND connected = false
    AND abandoned = false
    AND EXISTS (
      SELECT 1
      FROM public.one_vs_one_moves AS leave_move
      WHERE leave_move.room_id = p_room_id
        AND leave_move.player_id = one_vs_one_players.user_id
        AND leave_move.action = 'manual_leave_takeover'
    )
  ORDER BY takeover_started_at ASC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  v_winning_team := CASE
    WHEN v_leaver.team_id = 'teamA' THEN 'teamB'
    ELSE 'teamA'
  END;
  v_winner_score := COALESCE(
    (v_room.state #>> ARRAY['teamScores', v_winning_team])::integer,
    0
  );
  v_loser_score := COALESCE(
    (
      v_room.state #>> ARRAY[
        'teamScores',
        CASE WHEN v_winning_team = 'teamA' THEN 'teamB' ELSE 'teamA' END
      ]
    )::integer,
    0
  );

  SELECT * INTO v_reward
  FROM public.calculate_match_reward(v_winner_score, v_loser_score);

  v_state := COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object(
      'winningTeamId', v_winning_team,
      'forfeitByPlayerId', v_leaver.user_id,
      'forfeitReason', 'manual_leave_after_round',
      'finishReason', 'opponent_manual_leave',
      'matchReward', jsonb_build_object(
        'tier', v_reward.tier,
        'gold', v_reward.gold,
        'points', v_reward.points
      ),
      'canDrawTile', false
    );

  UPDATE public.one_vs_one_players
  SET abandoned = true,
      connected = false,
      updated_at = now()
  WHERE id = v_leaver.id;

  UPDATE public.one_vs_one_rooms
  SET status = 'finished',
      state = v_state,
      current_turn_player_id = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO public.one_vs_one_moves (
    room_id,
    player_id,
    sequence,
    action,
    payload
  ) VALUES (
    p_room_id,
    v_leaver.user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    'round_end_leave_forfeit',
    jsonb_build_object(
      'user_id', v_leaver.user_id,
      'team_id', v_leaver.team_id,
      'winner_team', v_winning_team,
      'reason', 'manual_leave_after_round'
    )
  );

  PERFORM public.settle_finished_match_rewards('1v1', p_room_id);
  PERFORM public.settle_one_vs_one_bet(p_room_id);

  RETURN jsonb_build_object(
    'forfeit', true,
    'winner_team', v_winning_team,
    'reason', 'manual_leave_after_round'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.leave_one_vs_one_match(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid)
TO service_role;
