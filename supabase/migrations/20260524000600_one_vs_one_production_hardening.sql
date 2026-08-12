CREATE TABLE IF NOT EXISTS public.one_vs_one_private_states (
  room_id uuid PRIMARY KEY REFERENCES public.one_vs_one_rooms(id) ON DELETE CASCADE,
  hands jsonb NOT NULL DEFAULT '[]'::jsonb,
  boneyard jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.one_vs_one_rooms
ADD COLUMN IF NOT EXISTS move_sequence int NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.next_one_vs_one_move_sequence(p_room_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sequence int;
BEGIN
  UPDATE public.one_vs_one_rooms
  SET move_sequence = move_sequence + 1
  WHERE id = p_room_id
  RETURNING move_sequence INTO v_sequence;

  IF v_sequence IS NULL THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  RETURN v_sequence;
END;
$$;
ALTER TABLE public.one_vs_one_players
ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS bot_takeover boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS takeover_started_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS takeover_expires_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS abandoned boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.one_vs_one_matchmaking_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('searching', 'matched', 'cancelled')),
  matched_room_id uuid REFERENCES public.one_vs_one_rooms(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_one_vs_one_matchmaking_status_created
ON public.one_vs_one_matchmaking_queue(status, created_at)
WHERE status = 'searching';
CREATE OR REPLACE FUNCTION public.set_one_vs_one_private_states_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_set_one_vs_one_private_states_updated_at
ON public.one_vs_one_private_states;
CREATE TRIGGER trigger_set_one_vs_one_private_states_updated_at
BEFORE UPDATE ON public.one_vs_one_private_states
FOR EACH ROW
EXECUTE FUNCTION public.set_one_vs_one_private_states_updated_at();
CREATE OR REPLACE FUNCTION public.set_one_vs_one_matchmaking_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_set_one_vs_one_matchmaking_updated_at
ON public.one_vs_one_matchmaking_queue;
CREATE TRIGGER trigger_set_one_vs_one_matchmaking_updated_at
BEFORE UPDATE ON public.one_vs_one_matchmaking_queue
FOR EACH ROW
EXECUTE FUNCTION public.set_one_vs_one_matchmaking_updated_at();
INSERT INTO public.one_vs_one_private_states (room_id, hands, boneyard)
SELECT
  id,
  COALESCE(state -> 'hands', '[]'::jsonb),
  COALESCE(state -> 'boneyard', '[]'::jsonb)
FROM public.one_vs_one_rooms
WHERE state ? 'hands'
ON CONFLICT (room_id) DO NOTHING;
UPDATE public.one_vs_one_rooms
SET state = (
  state
  || CASE
    WHEN state ? 'hands' THEN jsonb_build_object(
      'handCounts',
      jsonb_build_array(
        jsonb_array_length(COALESCE(state #> '{hands,0}', '[]'::jsonb)),
        jsonb_array_length(COALESCE(state #> '{hands,1}', '[]'::jsonb))
      )
    )
    ELSE '{}'::jsonb
  END
  || CASE
    WHEN state ? 'boneyard' THEN jsonb_build_object(
      'boneyardCount',
      jsonb_array_length(COALESCE(state -> 'boneyard', '[]'::jsonb))
    )
    ELSE '{}'::jsonb
  END
) - 'hands' - 'boneyard'
WHERE state ? 'hands' OR state ? 'boneyard';
CREATE OR REPLACE FUNCTION public.find_one_vs_one_opponent()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_opponent public.one_vs_one_matchmaking_queue%ROWTYPE;
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_seat text;
  v_team text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM public.one_vs_one_matchmaking_queue
  WHERE user_id = v_user_id
     OR (status = 'searching' AND created_at < now() - interval '5 minutes');

  SELECT *
  INTO v_opponent
  FROM public.one_vs_one_matchmaking_queue
  WHERE status = 'searching'
    AND user_id <> v_user_id
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    INSERT INTO public.one_vs_one_rooms (
      host_user_id,
      room_code,
      status,
      bet_amount,
      player_count
    ) VALUES (
      v_user_id,
      public.generate_one_vs_one_room_code(),
      'active',
      0,
      2
    )
    RETURNING * INTO v_room;

    SELECT seat, team_id INTO v_seat, v_team
    FROM public.resolve_one_vs_one_seat_assignment(0);

    INSERT INTO public.one_vs_one_players (
      room_id, user_id, kind, seat, team_id, player_index, is_ready, connected
    ) VALUES (
      v_room.id, v_opponent.user_id, 'human', v_seat, v_team, 0, true, true
    );

    SELECT seat, team_id INTO v_seat, v_team
    FROM public.resolve_one_vs_one_seat_assignment(1);

    INSERT INTO public.one_vs_one_players (
      room_id, user_id, kind, seat, team_id, player_index, is_ready, connected
    ) VALUES (
      v_room.id, v_user_id, 'human', v_seat, v_team, 1, true, true
    );

    UPDATE public.one_vs_one_matchmaking_queue
    SET status = 'matched',
        matched_room_id = v_room.id,
        ended_at = now()
    WHERE user_id = v_opponent.user_id;

    INSERT INTO public.one_vs_one_matchmaking_queue (
      user_id,
      status,
      matched_room_id,
      ended_at
    ) VALUES (
      v_user_id,
      'matched',
      v_room.id,
      now()
    );

    INSERT INTO public.one_vs_one_moves (
      room_id, player_id, sequence, action, payload
    ) VALUES (
      v_room.id,
      v_user_id,
      public.next_one_vs_one_move_sequence(v_room.id),
      'match_created',
      jsonb_build_object('player_1', v_opponent.user_id, 'player_2', v_user_id)
    );

    RETURN jsonb_build_object(
      'status', 'matched',
      'room_id', v_room.id,
      'room_code', v_room.room_code,
      'opponent_user_id', v_opponent.user_id
    );
  END IF;

  INSERT INTO public.one_vs_one_matchmaking_queue (user_id, status)
  VALUES (v_user_id, 'searching');

  RETURN jsonb_build_object('status', 'searching');
END;
$$;
CREATE OR REPLACE FUNCTION public.get_one_vs_one_matchmaking_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.one_vs_one_matchmaking_queue%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_row
  FROM public.one_vs_one_matchmaking_queue
  WHERE user_id = v_user_id
    AND status IN ('searching', 'matched')
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  RETURN jsonb_build_object(
    'status', v_row.status,
    'mode', '1v1',
    'matched_room_id', v_row.matched_room_id,
    'wait_seconds', EXTRACT(EPOCH FROM (now() - v_row.created_at))::int
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.cancel_one_vs_one_matchmaking(p_room_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_remaining_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF p_room_id IS NOT NULL THEN
    PERFORM 1 FROM public.one_vs_one_rooms WHERE id=p_room_id FOR UPDATE;
    IF FOUND THEN
      IF EXISTS(SELECT 1 FROM public.one_vs_one_private_states WHERE room_id=p_room_id) THEN
        RAISE EXCEPTION 'match_already_started';
      END IF;
      DELETE FROM public.one_vs_one_players
      WHERE room_id=p_room_id AND user_id=v_user_id;
      SELECT count(*) INTO v_remaining_count
      FROM public.one_vs_one_players WHERE room_id=p_room_id;
      UPDATE public.one_vs_one_rooms
      SET player_count=GREATEST(1,v_remaining_count),
          status=CASE WHEN v_remaining_count=0 THEN 'cancelled' ELSE 'waiting' END,
          current_turn_player_id=NULL,version=version+1,updated_at=now()
      WHERE id=p_room_id;
    END IF;
  END IF;

  UPDATE public.one_vs_one_matchmaking_queue
  SET status='cancelled',matched_room_id=NULL,ended_at=now(),updated_at=now()
  WHERE user_id=v_user_id AND status IN ('searching','matched');
  UPDATE public.user_presence
  SET status='online_available',last_seen_at=now(),updated_at=now()
  WHERE user_id=v_user_id;
  RETURN jsonb_build_object('status','cancelled','remaining_count',v_remaining_count);
END;
$$;
CREATE OR REPLACE FUNCTION public.start_one_vs_one_game(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
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

  IF EXISTS (SELECT 1 FROM public.one_vs_one_private_states WHERE room_id = p_room_id) THEN
    RETURN jsonb_build_object('status', 'success', 'message', '1v1 game already started', 'room_id', p_room_id);
  END IF;

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

  SELECT d INTO v_opening_double
  FROM generate_series(6, 0, -1) AS d
  WHERE v_hands @> jsonb_build_array(jsonb_build_array(jsonb_build_object('left', d, 'right', d)))
     OR v_hands @> jsonb_build_array(jsonb_build_array(jsonb_build_object('id', d || '-' || d)))
  ORDER BY d DESC
  LIMIT 1;

  IF v_opening_double IS NOT NULL THEN
    SELECT idx - 1 INTO v_leading_player_index
    FROM jsonb_array_elements(v_hands) WITH ORDINALITY AS hand(hand_json, idx)
    WHERE hand_json @> jsonb_build_array(jsonb_build_object('left', v_opening_double, 'right', v_opening_double))
       OR hand_json @> jsonb_build_array(jsonb_build_object('id', v_opening_double || '-' || v_opening_double))
    ORDER BY idx ASC
    LIMIT 1;
  END IF;

  SELECT user_id INTO v_current_turn_player_id
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id AND player_index = v_leading_player_index
  LIMIT 1;

  INSERT INTO public.one_vs_one_private_states(room_id, hands, boneyard)
  VALUES (p_room_id, v_hands, v_boneyard);

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
    'openingDouble', v_opening_double,
    'openingTileId', CASE WHEN v_opening_double IS NULL THEN NULL ELSE v_opening_double || '-' || v_opening_double END,
    'isFirstRound', true,
    'isOpeningRound', true,
    'spinnerValue', NULL,
    'teamScores', jsonb_build_object('teamA', 0, 'teamB', 0),
    'roundWinnerPlayerId', NULL,
    'lastPlayedTile', NULL,
    'canDrawTile', false,
    'matchReward', NULL,
    'winningTeamId', NULL,
    'lastScoringEvent', NULL,
    'lastPassedPlayerId', NULL,
    'blockedPasses', jsonb_build_array()
  );

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
    'game_started',
    jsonb_build_object('leading_player_index', v_leading_player_index, 'opening_double', v_opening_double)
  );

  RETURN jsonb_build_object('status', 'success', 'room_id', p_room_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.cancel_one_vs_one_room(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_leaver public.one_vs_one_players%ROWTYPE;
  v_winning_team text;
  v_state jsonb;
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

  SELECT * INTO v_leaver
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a player in this 1v1 room';
  END IF;

  UPDATE public.one_vs_one_players
  SET connected = false,
      left_at = now(),
      updated_at = now()
  WHERE id = v_leaver.id;

  IF v_room.status = 'active' THEN
    v_winning_team := CASE WHEN v_leaver.team_id = 'teamA' THEN 'teamB' ELSE 'teamA' END;
    v_state := COALESCE(v_room.state, '{}'::jsonb)
      || jsonb_build_object(
        'winningTeamId', v_winning_team,
        'forfeitByPlayerId', v_user_id,
        'matchReward', jsonb_build_object('tier', 'normal', 'gold', 6, 'points', 20),
        'canDrawTile', false
      );

    UPDATE public.one_vs_one_rooms
    SET status = 'finished',
        state = v_state,
        current_turn_player_id = NULL,
        version = version + 1,
        updated_at = now()
    WHERE id = p_room_id;
  ELSE
    UPDATE public.one_vs_one_rooms
    SET status = 'cancelled',
        version = version + 1,
        updated_at = now()
    WHERE id = p_room_id;
  END IF;

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    CASE WHEN v_room.status = 'active' THEN 'player_forfeited' ELSE 'room_cancelled' END,
    jsonb_build_object('user_id', v_user_id, 'previous_status', v_room.status)
  );

  RETURN jsonb_build_object('status', 'success', 'room_id', p_room_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.one_vs_one_player_heartbeat(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.one_vs_one_players
  SET connected = true,
      last_seen_at = now(),
      left_at = NULL,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND abandoned = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active player in this 1v1 room';
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.mark_one_vs_one_player_disconnected(p_room_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.one_vs_one_players
  SET connected = false,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND abandoned = false;

  RETURN jsonb_build_object('status', CASE WHEN FOUND THEN 'ok' ELSE 'not_found' END);
END;
$$;
CREATE OR REPLACE FUNCTION public.process_one_vs_one_takeovers(p_grace_seconds int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff timestamptz := now() - (p_grace_seconds || ' seconds')::interval;
  v_player record;
  v_taken int := 0;
BEGIN
  FOR v_player IN
    SELECT p.*
    FROM public.one_vs_one_players p
    JOIN public.one_vs_one_rooms r ON r.id = p.room_id
    WHERE r.status = 'active'
      AND p.bot_takeover = false
      AND p.abandoned = false
      AND (
        p.connected = false
        OR (p.last_seen_at IS NOT NULL AND p.last_seen_at < v_cutoff)
      )
  LOOP
    UPDATE public.one_vs_one_players
    SET bot_takeover = true,
        takeover_started_at = now(),
        takeover_expires_at = NULL,
        updated_at = now()
    WHERE id = v_player.id;

    INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
    VALUES (
      v_player.room_id,
      v_player.user_id,
      public.next_one_vs_one_move_sequence(v_player.room_id),
      'takeover_started',
      jsonb_build_object('player_index', v_player.player_index, 'user_id', v_player.user_id, 'reason', 'disconnect_timeout')
    );

    v_taken := v_taken + 1;
  END LOOP;

  RETURN v_taken;
END;
$$;
CREATE OR REPLACE FUNCTION public.restore_one_vs_one_human_control(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.one_vs_one_players
  SET bot_takeover = false,
      takeover_started_at = NULL,
      takeover_expires_at = NULL,
      connected = true,
      last_seen_at = now(),
      left_at = NULL,
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND abandoned = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active player in this 1v1 room';
  END IF;

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    'takeover_restored',
    jsonb_build_object('user_id', v_user_id)
  );

  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.evaluate_one_vs_one_abandonments_and_forfeits(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
  v_winning_team text;
  v_state jsonb;
BEGIN
  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  SELECT * INTO v_player
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND bot_takeover = true
    AND abandoned = false
  ORDER BY takeover_started_at ASC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('forfeit', false);
  END IF;

  v_winning_team := CASE WHEN v_player.team_id = 'teamA' THEN 'teamB' ELSE 'teamA' END;
  v_state := COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object(
      'winningTeamId', v_winning_team,
      'forfeitByPlayerId', v_player.user_id,
      'forfeitReason', 'abandoned',
      'matchReward', jsonb_build_object('tier', 'normal', 'gold', 6, 'points', 20),
      'canDrawTile', false
    );

  UPDATE public.one_vs_one_players
  SET abandoned = true,
      connected = false,
      updated_at = now()
  WHERE id = v_player.id;

  UPDATE public.one_vs_one_rooms
  SET status = 'finished',
      state = v_state,
      current_turn_player_id = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_player.user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    'player_abandoned_forfeit',
    jsonb_build_object('user_id', v_player.user_id, 'team_id', v_player.team_id, 'winner_team', v_winning_team)
  );

  RETURN jsonb_build_object('forfeit', true, 'winner_team', v_winning_team);
END;
$$;
CREATE OR REPLACE FUNCTION public.get_one_vs_one_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_private public.one_vs_one_private_states%ROWTYPE;
  v_player_index int;
  v_hand jsonb := '[]'::jsonb;
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

  SELECT *
  INTO v_private
  FROM public.one_vs_one_private_states
  WHERE room_id = p_room_id;

  IF FOUND THEN
    v_hand := COALESCE(v_private.hands -> v_player_index, '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'id', v_room.id,
    'status', v_room.status,
    'version', v_room.version,
    'current_turn_player_id', v_room.current_turn_player_id,
    'state', v_room.state || jsonb_build_object('myHand', v_hand)
  );
END;
$$;
DROP POLICY IF EXISTS "one_vs_one_rooms_select_authenticated" ON public.one_vs_one_rooms;
DROP POLICY IF EXISTS "one_vs_one_players_select_authenticated" ON public.one_vs_one_players;
DROP POLICY IF EXISTS "one_vs_one_moves_select_authenticated" ON public.one_vs_one_moves;
DROP POLICY IF EXISTS "one_vs_one_rooms_insert_owner" ON public.one_vs_one_rooms;
DROP POLICY IF EXISTS "one_vs_one_rooms_update_owner" ON public.one_vs_one_rooms;
DROP POLICY IF EXISTS "one_vs_one_players_insert_owner" ON public.one_vs_one_players;
DROP POLICY IF EXISTS "one_vs_one_players_update_owner" ON public.one_vs_one_players;
DROP POLICY IF EXISTS "one_vs_one_rooms_select_players" ON public.one_vs_one_rooms;
DROP POLICY IF EXISTS "one_vs_one_players_select_room_members" ON public.one_vs_one_players;
DROP POLICY IF EXISTS "one_vs_one_moves_select_room_members" ON public.one_vs_one_moves;
DROP POLICY IF EXISTS "one_vs_one_rooms_insert_via_rpc_only" ON public.one_vs_one_rooms;
DROP POLICY IF EXISTS "one_vs_one_rooms_update_via_rpc_only" ON public.one_vs_one_rooms;
DROP POLICY IF EXISTS "one_vs_one_players_insert_via_rpc_only" ON public.one_vs_one_players;
DROP POLICY IF EXISTS "one_vs_one_players_update_via_rpc_only" ON public.one_vs_one_players;
CREATE OR REPLACE FUNCTION public.is_one_vs_one_room_member(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.one_vs_one_players
    WHERE room_id = p_room_id
      AND user_id = auth.uid()
  );
$$;
CREATE POLICY "one_vs_one_rooms_select_players"
ON public.one_vs_one_rooms
FOR SELECT
TO authenticated
USING (public.is_one_vs_one_room_member(id));
CREATE POLICY "one_vs_one_players_select_room_members"
ON public.one_vs_one_players
FOR SELECT
TO authenticated
USING (public.is_one_vs_one_room_member(room_id));
CREATE POLICY "one_vs_one_moves_select_room_members"
ON public.one_vs_one_moves
FOR SELECT
TO authenticated
USING (public.is_one_vs_one_room_member(room_id));
CREATE POLICY "one_vs_one_rooms_insert_via_rpc_only"
ON public.one_vs_one_rooms
FOR INSERT
TO authenticated
WITH CHECK (false);
CREATE POLICY "one_vs_one_rooms_update_via_rpc_only"
ON public.one_vs_one_rooms
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);
CREATE POLICY "one_vs_one_players_insert_via_rpc_only"
ON public.one_vs_one_players
FOR INSERT
TO authenticated
WITH CHECK (false);
CREATE POLICY "one_vs_one_players_update_via_rpc_only"
ON public.one_vs_one_players
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);
ALTER TABLE public.one_vs_one_private_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_vs_one_matchmaking_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "one_vs_one_private_states_no_client_select" ON public.one_vs_one_private_states;
CREATE POLICY "one_vs_one_private_states_no_client_select"
ON public.one_vs_one_private_states
FOR SELECT
TO authenticated
USING (false);
DROP POLICY IF EXISTS "one_vs_one_matchmaking_select_own" ON public.one_vs_one_matchmaking_queue;
CREATE POLICY "one_vs_one_matchmaking_select_own"
ON public.one_vs_one_matchmaking_queue
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE ON public.one_vs_one_matchmaking_queue TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_one_vs_one_opponent() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_one_vs_one_matchmaking_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_one_vs_one_matchmaking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_one_vs_one_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_one_vs_one_move_sequence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_one_vs_one_room_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.one_vs_one_player_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_one_vs_one_player_disconnected(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_one_vs_one_takeovers(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_one_vs_one_human_control(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_one_vs_one_abandonments_and_forfeits(uuid) TO authenticated;
