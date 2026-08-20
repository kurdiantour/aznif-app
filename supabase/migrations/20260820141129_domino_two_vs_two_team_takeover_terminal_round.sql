-- Domino 2v2 terminal-round policy.
-- One takeover is non-terminal. A whole team with explicit manual-leave or
-- consecutive-timeout takeover events forfeits only after the current round.
-- Presence and disconnect state never create a terminal cause.

CREATE OR REPLACE FUNCTION public.apply_two_vs_two_timeout_strike_takeover(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

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
    IF NOT EXISTS (
      SELECT 1
      FROM public.two_vs_two_moves AS event
      WHERE event.room_id = p_room_id
        AND event.player_id = p_user_id
        AND event.action = 'timeout_takeover'
    ) THEN
      INSERT INTO public.two_vs_two_moves (
        room_id, player_id, sequence, action, payload
      ) VALUES (
        p_room_id,
        p_user_id,
        public.next_two_vs_two_move_sequence(p_room_id),
        'timeout_takeover',
        jsonb_build_object(
          'reason', 'consecutive_timeouts',
          'timeout_strikes', 2,
          'user_id', p_user_id
        )
      );
    END IF;

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
SET search_path = ''
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
  WHERE (
      SELECT COUNT(*)
      FROM public.two_vs_two_players AS member
      WHERE member.room_id = p_room_id
        AND member.team_id = team.team_id
    ) = 2
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
            FROM public.two_vs_two_moves AS takeover_event
            WHERE takeover_event.room_id = member.room_id
              AND takeover_event.player_id = member.user_id
              AND takeover_event.action IN (
                'manual_leave_takeover',
                'timeout_takeover'
              )
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
      'status', 'finished',
      'matchFinished', true,
      'winningTeamId', v_winning_team,
      'forfeitTeamId', v_losing_team,
      'forfeitReason', 'team_takeover_after_round',
      'finishReason', 'opponent_team_taken_over',
      'gameOverReason', 'opponent_team_taken_over',
      'matchReward', jsonb_build_object(
        'tier', v_reward.tier,
        'gold', v_reward.gold,
        'points', v_reward.points
      ),
      'canDrawTile', false
    );

  UPDATE public.two_vs_two_players
  SET abandoned = true,
      connected = false,
      updated_at = now()
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
    'round_end_team_takeover_forfeit',
    jsonb_build_object(
      'losing_team', v_losing_team,
      'winner_team', v_winning_team,
      'reason', 'team_takeover_after_round'
    )
  );

  PERFORM public.domino_settle_match('2v2', p_room_id);

  RETURN jsonb_build_object(
    'forfeit', true,
    'winner_team', v_winning_team,
    'losing_team', v_losing_team,
    'reason', 'team_takeover_after_round'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_two_vs_two_takeover_after_round()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active'
     AND NULLIF(NEW.state ->> 'roundWinnerPlayerId', '') IS NOT NULL
     AND (
       OLD.state IS DISTINCT FROM NEW.state
       OR NULLIF(OLD.state ->> 'roundWinnerPlayerId', '') IS NULL
     )
  THEN
    PERFORM public.resolve_two_vs_two_round_leave_forfeits(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finalize_two_vs_two_takeover_after_round
ON public.two_vs_two_rooms;

CREATE TRIGGER trg_finalize_two_vs_two_takeover_after_round
AFTER UPDATE OF state ON public.two_vs_two_rooms
FOR EACH ROW
EXECUTE FUNCTION public.finalize_two_vs_two_takeover_after_round();

REVOKE ALL ON FUNCTION public.apply_two_vs_two_timeout_strike_takeover(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_two_vs_two_timeout_strike_takeover(uuid, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.resolve_two_vs_two_round_leave_forfeits(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_two_vs_two_round_leave_forfeits(uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.finalize_two_vs_two_takeover_after_round()
FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
