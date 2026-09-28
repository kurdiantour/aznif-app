-- Shared statistics only. Gameplay and economic policies remain unchanged.
-- No backfill: deploy after draining active matches with legacy manual losses.
CREATE SCHEMA IF NOT EXISTS multiplayer_private;
REVOKE ALL ON SCHEMA multiplayer_private FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE public.multiplayer_match_stat_results (
  game_type text NOT NULL CHECK (game_type IN ('okey', 'domino_1v1', 'domino_2v2')),
  match_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('win', 'loss')),
  reason text NOT NULL CHECK (reason IN ('manual_leave', 'match_finished')),
  team_id text NOT NULL CHECK (team_id IN ('teamA', 'teamB')),
  source_version bigint NOT NULL CHECK (source_version >= 0),
  source_event_id text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (game_type, match_id, user_id),
  CHECK (reason <> 'manual_leave' OR outcome = 'loss')
);
CREATE INDEX multiplayer_match_stat_results_user_idx ON public.multiplayer_match_stat_results(user_id);
ALTER TABLE public.multiplayer_match_stat_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multiplayer_match_stat_results FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.multiplayer_match_stat_results TO service_role;
ALTER TABLE public.one_vs_one_rooms ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.two_vs_two_rooms ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE FUNCTION multiplayer_private.record_player_results(
  p_game_type text, p_match_id uuid, p_version bigint, p_event_id text, p_results jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result record;
  v_existing public.multiplayer_match_stat_results%ROWTYPE;
BEGIN
  IF p_results IS NULL OR jsonb_typeof(p_results) <> 'array' THEN
    RAISE EXCEPTION 'invalid_match_stat_results';
  END IF;
  FOR v_result IN SELECT * FROM jsonb_to_recordset(p_results)
    AS r(user_id uuid, team_id text, outcome text, reason text) ORDER BY user_id
  LOOP
    PERFORM 1 FROM public.profiles WHERE id = v_result.user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'stats_profile_not_initialized'; END IF;
    INSERT INTO public.multiplayer_match_stat_results
      (game_type, match_id, user_id, outcome, reason, team_id, source_version, source_event_id)
    VALUES (p_game_type, p_match_id, v_result.user_id, v_result.outcome,
      v_result.reason, v_result.team_id, p_version, p_event_id)
    ON CONFLICT (game_type, match_id, user_id) DO NOTHING;
    IF FOUND THEN
      UPDATE public.profiles SET
        games_played = COALESCE(games_played, 0) + 1,
        games_won = COALESCE(games_won, 0) + CASE WHEN v_result.outcome = 'win' THEN 1 ELSE 0 END,
        games_lost = COALESCE(games_lost, 0) + CASE WHEN v_result.outcome = 'loss' THEN 1 ELSE 0 END,
        updated_at = now() WHERE id = v_result.user_id;
    ELSE
      SELECT * INTO STRICT v_existing FROM public.multiplayer_match_stat_results
      WHERE game_type = p_game_type AND match_id = p_match_id AND user_id = v_result.user_id;
      IF v_existing.reason <> 'manual_leave'
         AND (v_existing.outcome IS DISTINCT FROM v_result.outcome
           OR v_existing.reason IS DISTINCT FROM v_result.reason
           OR v_existing.team_id IS DISTINCT FROM v_result.team_id) THEN
        RAISE EXCEPTION 'conflicting_match_stat_result';
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION multiplayer_private.record_okey_committed_stats(
  p_match_id uuid, p_user_id uuid, p_command_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_match okey.matches%ROWTYPE;
  v_state jsonb;
  v_command okey.match_commands%ROWTYPE;
  v_results jsonb;
  v_winner text;
BEGIN
  SELECT * INTO STRICT v_match FROM okey.matches WHERE id = p_match_id FOR UPDATE;
  IF v_match.is_test THEN RETURN; END IF;
  SELECT * INTO STRICT v_command FROM okey.match_commands
    WHERE match_id = p_match_id AND command_id = p_command_id AND user_id = p_user_id;
  SELECT state INTO STRICT v_state FROM okey.match_private_states WHERE match_id = p_match_id;
  IF v_command.command_type = 'manual-leave' THEN
    IF NOT COALESCE(v_state->'manualLeftPlayerIds' ? p_user_id::text, false) THEN
      RAISE EXCEPTION 'manual_leave_missing_from_committed_state';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('user_id', user_id, 'team_id', team_id,
      'outcome', 'loss', 'reason', 'manual_leave')) INTO v_results
    FROM okey.match_seats WHERE match_id = p_match_id AND user_id = p_user_id;
    IF v_results IS NULL THEN RAISE EXCEPTION 'stats_human_seat_not_found'; END IF;
    PERFORM multiplayer_private.record_player_results('okey', p_match_id,
      v_command.applied_version, p_command_id::text, v_results);
  END IF;
  v_winner := v_state->>'matchWinnerTeamId';
  IF v_match.status <> 'finished'
     OR NOT COALESCE((v_state->>'matchFinished')::boolean, false)
     OR v_winner IS NULL OR v_winner NOT IN ('teamA', 'teamB') THEN RETURN; END IF;
  -- User-backed seats retain human identity when controlled by a bot.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'team_id', team_id,
    'outcome', CASE WHEN team_id = v_winner THEN 'win' ELSE 'loss' END,
    'reason', 'match_finished')), '[]'::jsonb) INTO v_results
  FROM okey.match_seats WHERE match_id = p_match_id
    AND NOT COALESCE(v_state->'manualLeftPlayerIds' ? user_id::text, false);
  PERFORM multiplayer_private.record_player_results('okey', p_match_id,
    v_command.applied_version, p_command_id::text, v_results);
END;
$$;

CREATE FUNCTION multiplayer_private.record_domino_manual_leave_stats(
  p_mode text, p_room_id uuid, p_user_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prefix text; v_room record; v_results jsonb;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('1v1','2v2') THEN RAISE EXCEPTION 'invalid_match_mode'; END IF;
  v_prefix := CASE WHEN p_mode='1v1' THEN 'one_vs_one' ELSE 'two_vs_two' END;
  EXECUTE format('SELECT status, version, is_test FROM public.%I WHERE id=$1 FOR UPDATE', v_prefix||'_rooms')
    INTO STRICT v_room USING p_room_id;
  IF v_room.is_test OR v_room.status <> 'active' THEN RETURN; END IF;
  EXECUTE format(
    'SELECT jsonb_agg(jsonb_build_object(''user_id'', p.user_id, ''team_id'', p.team_id,
      ''outcome'', ''loss'', ''reason'', ''manual_leave''))
     FROM public.%I p WHERE p.room_id=$1 AND p.user_id=$2 AND p.kind=''human''
       AND EXISTS (SELECT 1 FROM public.%I m WHERE m.room_id=$1 AND m.player_id=$2
         AND m.action=''manual_leave_takeover'')', v_prefix||'_players', v_prefix||'_moves')
    INTO v_results USING p_room_id, p_user_id;
  IF v_results IS NULL THEN RAISE EXCEPTION 'stats_manual_leave_not_authoritative'; END IF;
  PERFORM multiplayer_private.record_player_results('domino_'||p_mode, p_room_id,
    v_room.version, 'manual_leave_takeover', v_results);
END;
$$;

CREATE FUNCTION multiplayer_private.record_domino_final_stats(p_mode text, p_room_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prefix text; v_room record; v_winner text; v_results jsonb;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('1v1','2v2') THEN RAISE EXCEPTION 'invalid_match_mode'; END IF;
  v_prefix := CASE WHEN p_mode='1v1' THEN 'one_vs_one' ELSE 'two_vs_two' END;
  EXECUTE format('SELECT status, state, version, is_test FROM public.%I WHERE id=$1 FOR UPDATE', v_prefix||'_rooms')
    INTO v_room USING p_room_id;
  IF v_room IS NULL THEN RETURN; END IF;
  -- Existing authoritative terminal marker (2v2 may still have active status).
  -- Deferred execution reads the final value AFTER the existing forfeit resolvers.
  v_winner := v_room.state->>'winningTeamId';
  IF v_room.is_test OR v_room.status NOT IN ('active','finished')
     OR v_winner IS NULL OR v_winner NOT IN ('teamA','teamB') THEN RETURN; END IF;
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(jsonb_build_object(''user_id'', p.user_id, ''team_id'', p.team_id,
      ''outcome'', CASE WHEN p.team_id=$2 THEN ''win'' ELSE ''loss'' END,
      ''reason'', ''match_finished'')), ''[]''::jsonb)
     FROM public.%I p WHERE p.room_id=$1 AND p.kind=''human'' AND p.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.%I m WHERE m.room_id=$1
         AND m.player_id=p.user_id AND m.action=''manual_leave_takeover'')',
    v_prefix||'_players', v_prefix||'_moves') INTO v_results USING p_room_id, v_winner;
  PERFORM multiplayer_private.record_player_results('domino_'||p_mode, p_room_id,
    v_room.version, NULL, v_results);
END;
$$;

CREATE FUNCTION multiplayer_private.capture_domino_final_stats()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM multiplayer_private.record_domino_final_stats(TG_ARGV[0], NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS record_one_vs_one_match_stats ON public.one_vs_one_rooms;
DROP TRIGGER IF EXISTS record_two_vs_two_match_stats ON public.two_vs_two_rooms;
DROP FUNCTION IF EXISTS public.record_finished_match_stats();
CREATE CONSTRAINT TRIGGER capture_one_vs_one_final_match_stats
AFTER UPDATE ON public.one_vs_one_rooms DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW.state IS DISTINCT FROM OLD.state OR NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION multiplayer_private.capture_domino_final_stats('1v1');
CREATE CONSTRAINT TRIGGER capture_two_vs_two_final_match_stats
AFTER UPDATE ON public.two_vs_two_rooms DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW.state IS DISTINCT FROM OLD.state OR NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION multiplayer_private.capture_domino_final_stats('2v2');
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA multiplayer_private FROM PUBLIC, anon, authenticated, service_role;

-- Existing RPC bodies: only statistics integration changes below.
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
      updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_not_initialized';
    END IF;
  END IF;

  RETURN p_room_id;
END;
$$;

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

    PERFORM multiplayer_private.record_domino_manual_leave_stats('1v1', p_room_id, v_user_id);

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

    PERFORM multiplayer_private.record_domino_manual_leave_stats('2v2', p_room_id, v_user_id);

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

-- Return the deadline actually persisted after the authoritative BEFORE UPDATE guard.
create or replace function public.okey_commit_authoritative_command(
  p_match_id uuid,
  p_user_id uuid,
  p_command_id uuid,
  p_expected_version bigint,
  p_command_type text,
  p_state jsonb,
  p_projection jsonb,
  p_status text,
  p_turn_deadline_at timestamptz
)
returns table (
  applied boolean,
  version bigint,
  state jsonb,
  turn_deadline_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_match okey.matches%rowtype;
  v_existing okey.match_commands%rowtype;
  v_private_state jsonb;
  v_next_version bigint;
  v_committed_deadline timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required'
      using errcode = '22023';
  end if;

  if p_user_id is null then
    raise exception 'user_id_required'
      using errcode = '22023';
  end if;

  if p_command_id is null then
    raise exception 'command_id_required'
      using errcode = '22023';
  end if;

  if p_expected_version is null
     or p_expected_version < 0 then
    raise exception 'invalid_expected_version'
      using errcode = '22023';
  end if;

  if p_command_type is null
     or char_length(trim(p_command_type)) = 0
     or char_length(p_command_type) > 100 then
    raise exception 'invalid_command_type'
      using errcode = '22023';
  end if;

  if p_state is null then
    raise exception 'state_required'
      using errcode = '22023';
  end if;

  if p_projection is null then
    raise exception 'projection_required'
      using errcode = '22023';
  end if;

  if p_status not in ('playing', 'finished') then
    raise exception 'invalid_commit_status'
      using errcode = '22023';
  end if;


  -- Lock the match so version validation and commit are atomic.
  select *
  into v_match
  from okey.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found'
      using errcode = 'P0002';
  end if;


  -- A finished or cancelled match may not accept new commands.
  if v_match.status in ('finished', 'cancelled') then
    raise exception 'match_not_active'
      using errcode = 'P0001';
  end if;

  if v_match.status <> 'playing' then
    raise exception 'match_not_playing'
      using errcode = 'P0001';
  end if;


  -- Return the current result when this command was already committed.
  select *
  into v_existing
  from okey.match_commands
  where match_id = p_match_id
    and command_id = p_command_id;

  if found then
    select private_state.state
    into v_private_state
    from okey.match_private_states private_state
    where private_state.match_id = p_match_id;

    if not found then
      raise exception 'private_state_not_found'
        using errcode = 'P0002';
    end if;

    return query
    select
      false,
      v_match.version,
      v_private_state,
      v_match.turn_deadline_at;

    return;
  end if;


  if v_match.version <> p_expected_version then
    raise exception 'version_conflict'
      using errcode = '40001';
  end if;


  if not exists (
    select 1
    from okey.match_seats seat
    where seat.match_id = p_match_id
      and seat.user_id = p_user_id
  ) then
    raise exception 'not_a_participant'
      using errcode = '42501';
  end if;


  v_next_version := v_match.version + 1;


  update okey.match_private_states
  set
    state = p_state,
    updated_at = now()
  where match_id = p_match_id;

  if not found then
    raise exception 'private_state_not_found'
      using errcode = 'P0002';
  end if;


  update okey.matches
  set
    version = v_next_version,
    status = p_status,
    public_projection = p_projection,

    turn_deadline_at =
      case
        when p_status = 'finished'
          then null
        else p_turn_deadline_at
      end,

    updated_at = now(),

    finished_at =
      case
        when p_status = 'finished'
          then coalesce(finished_at, now())
        else finished_at
      end

  where id = p_match_id
  returning okey.matches.turn_deadline_at into v_committed_deadline;


  insert into okey.match_commands (
    match_id,
    command_id,
    user_id,
    expected_version,
    applied_version,
    command_type
  )
  values (
    p_match_id,
    p_command_id,
    p_user_id,
    p_expected_version,
    v_next_version,
    trim(p_command_type)
  );


  perform multiplayer_private.record_okey_committed_stats(p_match_id, p_user_id, p_command_id);

  return query
  select
    true,
    v_next_version,
    p_state,

    v_committed_deadline;
end;
$$;


revoke all on function public.okey_commit_authoritative_command(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  jsonb,
  jsonb,
  text,
  timestamptz
)
from public, anon, authenticated;


grant execute on function public.okey_commit_authoritative_command(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  jsonb,
  jsonb,
  text,
  timestamptz
)
to service_role;

NOTIFY pgrst, 'reload schema';
