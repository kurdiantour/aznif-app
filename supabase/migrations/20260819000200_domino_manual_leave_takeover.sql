-- ============================================================
-- Domino Manual Leave Takeover
-- Single source of truth for EXPLICIT manual leave in Domino 1v1 + 2v2.
--
-- This file recognizes ONLY explicit manual_leave_takeover events as Manual Leave.
-- Timeout bot_takeover rows are never treated as Manual Leave.
-- This file intentionally contains NO heartbeat/stale/disconnect takeover.
-- Timeout takeover is defined separately in domino_timeout_takeover.sql.
-- Bot turn execution remains exclusively in process_bot_turns.
-- ============================================================

CREATE OR REPLACE FUNCTION public.settle_free_one_vs_one_manual_forfeit(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
  v_inserted boolean := false;
BEGIN
  SELECT *
  INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.currency <> 'fun' THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_player
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND kind = 'human'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forfeiting human player not found';
  END IF;

  INSERT INTO public.domino_fun_match_rewards (
    mode,
    room_id,
    user_id,
    team_id,
    point_delta,
    gem_delta
  )
  VALUES (
    '1v1',
    p_room_id,
    p_user_id,
    v_player.team_id,
    -25,
    0
  )
  ON CONFLICT (mode, room_id, user_id) DO NOTHING;

  v_inserted := FOUND;

  IF v_inserted THEN
    UPDATE public.profiles
    SET
      points = GREATEST(0, COALESCE(points, 0) - 25),
      games_played = COALESCE(games_played, 0) + 1,
      games_lost = COALESCE(games_lost, 0) + 1,
      updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_not_initialized';
    END IF;
  END IF;

  RETURN p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_free_two_vs_two_manual_forfeit(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_player public.two_vs_two_players%ROWTYPE;
  v_inserted boolean := false;
BEGIN
  SELECT *
  INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  IF v_room.status <> 'active' THEN
    RAISE EXCEPTION 'Manual forfeit requires an active 2v2 match';
  END IF;

  IF v_room.currency <> 'fun' THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_player
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND kind = 'human'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forfeiting human player not found';
  END IF;

  INSERT INTO public.domino_fun_match_rewards (
    mode,
    room_id,
    user_id,
    team_id,
    point_delta,
    gem_delta
  )
  VALUES (
    '2v2',
    p_room_id,
    p_user_id,
    v_player.team_id,
    -25,
    0
  )
  ON CONFLICT (mode, room_id, user_id) DO NOTHING;

  v_inserted := FOUND;

  IF v_inserted THEN
    UPDATE public.profiles
    SET
      points = GREATEST(0, COALESCE(points, 0) - 25),
      games_played = COALESCE(games_played, 0) + 1,
      games_lost = COALESCE(games_lost, 0) + 1,
      updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_not_initialized';
    END IF;
  END IF;

  RETURN p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_one_vs_one_manual_leave_penalty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

  IF NEW.action = 'manual_leave_takeover'
     AND NEW.player_id IS NOT NULL
  THEN
    PERFORM public.settle_free_one_vs_one_manual_forfeit(
      NEW.room_id,
      NEW.player_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS one_vs_one_manual_leave_penalty
ON public.one_vs_one_moves;

CREATE TRIGGER one_vs_one_manual_leave_penalty
AFTER INSERT ON public.one_vs_one_moves
FOR EACH ROW
WHEN (NEW.action = 'manual_leave_takeover')
EXECUTE FUNCTION public.handle_one_vs_one_manual_leave_penalty();

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
  v_humans_before integer;
  v_humans_after integer;
  v_final_state jsonb;
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
    SELECT COUNT(*)::integer INTO v_humans_before
    FROM public.one_vs_one_players AS human
    WHERE human.room_id = p_room_id
      AND human.kind = 'human'
      AND NOT EXISTS (
        SELECT 1
        FROM public.one_vs_one_moves AS leave_move
        WHERE leave_move.room_id = p_room_id
          AND leave_move.player_id = human.user_id
          AND leave_move.action = 'manual_leave_takeover'
      );

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

    SELECT COUNT(*)::integer INTO v_humans_after
    FROM public.one_vs_one_players AS human
    WHERE human.room_id = p_room_id
      AND human.kind = 'human'
      AND NOT EXISTS (
        SELECT 1
        FROM public.one_vs_one_moves AS leave_move
        WHERE leave_move.room_id = p_room_id
          AND leave_move.player_id = human.user_id
          AND leave_move.action = 'manual_leave_takeover'
      );

    IF v_humans_before = 1 AND v_humans_after = 0 THEN
      v_final_state := COALESCE(v_room.state, '{}'::jsonb)
        || jsonb_build_object(
          'status', 'finished',
          'matchFinished', true,
          'winningTeamId', NULL,
          'finishReason', 'all_players_manual_leave',
          'forfeitReason', 'no_humans_remaining',
          'canDrawTile', false
        );

      UPDATE public.one_vs_one_players
      SET connected = false,
          bot_takeover = true,
          abandoned = true,
          updated_at = now()
      WHERE room_id = p_room_id
        AND kind = 'human'
        AND EXISTS (
          SELECT 1
          FROM public.one_vs_one_moves AS leave_move
          WHERE leave_move.room_id = p_room_id
            AND leave_move.player_id = one_vs_one_players.user_id
            AND leave_move.action = 'manual_leave_takeover'
        );

      UPDATE public.one_vs_one_rooms
      SET status = 'finished',
          state = v_final_state,
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
        NULL,
        public.next_one_vs_one_move_sequence(p_room_id),
        'all_players_manual_leave',
        jsonb_build_object(
          'reason', 'no_humans_remaining',
          'humans_before', v_humans_before,
          'humans_after', v_humans_after
        )
      );

      RETURN jsonb_build_object(
        'status', 'match_finished',
        'room_id', p_room_id,
        'result', 'no_winner',
        'finish_reason', 'all_players_manual_leave'
      );
    END IF;

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
  v_forfeit_settlement_id uuid;
  v_humans_before integer;
  v_humans_after integer;
  v_final_state jsonb;
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
    SELECT COUNT(*)::integer INTO v_humans_before
    FROM public.two_vs_two_players AS human
    WHERE human.room_id = p_room_id
      AND human.kind = 'human'
      AND NOT EXISTS (
        SELECT 1
        FROM public.two_vs_two_moves AS leave_move
        WHERE leave_move.room_id = p_room_id
          AND leave_move.player_id = human.user_id
          AND leave_move.action = 'manual_leave_takeover'
      );

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

    v_forfeit_settlement_id :=
      public.settle_free_two_vs_two_manual_forfeit(p_room_id, v_user_id);

    SELECT COUNT(*)::integer INTO v_humans_after
    FROM public.two_vs_two_players AS human
    WHERE human.room_id = p_room_id
      AND human.kind = 'human'
      AND NOT EXISTS (
        SELECT 1
        FROM public.two_vs_two_moves AS leave_move
        WHERE leave_move.room_id = p_room_id
          AND leave_move.player_id = human.user_id
          AND leave_move.action = 'manual_leave_takeover'
      );

    IF v_humans_before = 1 AND v_humans_after = 0 THEN
      v_final_state := COALESCE(v_room.state, '{}'::jsonb)
        || jsonb_build_object(
          'status', 'finished',
          'matchFinished', true,
          'winningTeamId', NULL,
          'finishReason', 'all_players_manual_leave',
          'forfeitReason', 'no_humans_remaining',
          'canDrawTile', false
        );

      UPDATE public.two_vs_two_players
      SET connected = false,
          bot_takeover = true,
          abandoned = true,
          updated_at = now()
      WHERE room_id = p_room_id
        AND kind = 'human'
        AND EXISTS (
          SELECT 1
          FROM public.two_vs_two_moves AS leave_move
          WHERE leave_move.room_id = p_room_id
            AND leave_move.player_id = two_vs_two_players.user_id
            AND leave_move.action = 'manual_leave_takeover'
        );

      UPDATE public.two_vs_two_rooms
      SET status = 'finished',
          state = v_final_state,
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
        'all_players_manual_leave',
        jsonb_build_object(
          'reason', 'no_humans_remaining',
          'humans_before', v_humans_before,
          'humans_after', v_humans_after
        )
      );

      RETURN jsonb_build_object(
        'status', 'match_finished',
        'room_id', p_room_id,
        'result', 'no_winner',
        'finish_reason', 'all_players_manual_leave',
        'settlement_id', v_forfeit_settlement_id
      );
    END IF;

    IF NULLIF(v_room.state ->> 'roundWinnerPlayerId', '') IS NOT NULL THEN
      PERFORM public.resolve_two_vs_two_round_leave_forfeits(p_room_id);
    END IF;

    RETURN jsonb_build_object(
      'status', 'bot_takeover',
      'room_id', p_room_id,
      'result', CASE
        WHEN v_forfeit_settlement_id IS NULL THEN NULL
        ELSE 'forfeit'
      END,
      'settlement_id', v_forfeit_settlement_id
    );
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
  v_state jsonb;
  v_settlement jsonb;
BEGIN
  SELECT *
  INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.status <> 'active'
     OR NULLIF(
       v_room.state ->> 'roundWinnerPlayerId',
       ''
     ) IS NULL
  THEN
    RETURN jsonb_build_object(
      'forfeit', false
    );
  END IF;

  SELECT *
  INTO v_leaver
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND bot_takeover = true
    AND connected = false
    AND abandoned = false
      AND EXISTS (
        SELECT 1
        FROM public.one_vs_one_moves AS ml
        WHERE ml.room_id = p_room_id
          AND ml.player_id = user_id
          AND ml.action = 'manual_leave_takeover'
      )
  ORDER BY takeover_started_at ASC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'forfeit', false
    );
  END IF;

  v_winning_team :=
    CASE
      WHEN v_leaver.team_id = 'teamA'
        THEN 'teamB'
      ELSE 'teamA'
    END;

  v_state :=
    COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object(
      'status', 'finished',
      'matchFinished', true,
      'winningTeamId', v_winning_team,
      'forfeitByPlayerId', v_leaver.user_id,
      'forfeitReason', 'player_left',
      'finishReason', 'opponent_left',
      'gameOverReason', 'opponent_left',
      'canDrawTile', false
    );

  UPDATE public.one_vs_one_players
  SET
    abandoned = true,
    connected = false,
    updated_at = now()
  WHERE id = v_leaver.id;

  UPDATE public.one_vs_one_rooms
  SET
    status = 'finished',
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
  )
  VALUES (
    p_room_id,
    v_leaver.user_id,
    public.next_one_vs_one_move_sequence(
      p_room_id
    ),
    'round_end_leave_forfeit',
    jsonb_build_object(
      'user_id', v_leaver.user_id,
      'team_id', v_leaver.team_id,
      'winner_team', v_winning_team,
      'reason', 'player_left'
    )
  );

  /*
   * IMPORTANT:
   * Use the canonical Domino settlement.
   * This handles Fun Coin / Aznif payout and
   * the existing reward/economy rules.
   */
  v_settlement :=
    public.domino_settle_match(
      '1v1',
      p_room_id
    );

  /*
   * Make the final settlement available
   * to the game-over/final result state.
   */
  UPDATE public.one_vs_one_rooms
  SET
    state =
      state
      || jsonb_build_object(
        'settlement', v_settlement,
        'onlineMatchResultReward', v_settlement
      ),
      version = version + 1,
      updated_at = now()
    WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'forfeit', true,
    'winner_team', v_winning_team,
    'reason', 'player_left',
    'settlement', v_settlement
  );
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

CREATE OR REPLACE FUNCTION public.finalize_one_vs_one_takeover_after_round()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'active'
     AND NULLIF(NEW.state ->> 'roundWinnerPlayerId', '') IS NOT NULL
     AND (
       OLD.state IS DISTINCT FROM NEW.state
       OR NULLIF(OLD.state ->> 'roundWinnerPlayerId', '') IS NULL
     )
     AND EXISTS (
       SELECT 1
       FROM public.one_vs_one_players p
       WHERE p.room_id = NEW.id
         AND p.bot_takeover = true
         AND p.connected = false
         AND p.abandoned = false
      AND EXISTS (
        SELECT 1
        FROM public.one_vs_one_moves AS ml
        WHERE ml.room_id = p.room_id
          AND ml.player_id = p.user_id
          AND ml.action = 'manual_leave_takeover'
      )
     )
  THEN
    PERFORM public.resolve_one_vs_one_round_leave_forfeits(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finalize_one_vs_one_takeover_after_round
ON public.one_vs_one_rooms;

CREATE TRIGGER trg_finalize_one_vs_one_takeover_after_round
AFTER UPDATE OF state ON public.one_vs_one_rooms
FOR EACH ROW
EXECUTE FUNCTION public.finalize_one_vs_one_takeover_after_round();

-- Permissions
REVOKE ALL ON FUNCTION public.leave_one_vs_one_match(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_one_vs_one_match(uuid)
TO authenticated;

REVOKE ALL ON FUNCTION public.leave_two_vs_two_match(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_two_vs_two_match(uuid)
TO authenticated;

REVOKE ALL ON FUNCTION public.settle_free_one_vs_one_manual_forfeit(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_free_one_vs_one_manual_forfeit(uuid, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.settle_free_two_vs_two_manual_forfeit(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_free_two_vs_two_manual_forfeit(uuid, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.resolve_two_vs_two_round_leave_forfeits(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_two_vs_two_round_leave_forfeits(uuid)
TO service_role;

NOTIFY pgrst, 'reload schema';