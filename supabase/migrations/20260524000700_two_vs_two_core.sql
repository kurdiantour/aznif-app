CREATE TABLE IF NOT EXISTS public.two_vs_two_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_code text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('waiting', 'active', 'finished', 'cancelled')),
  bet_amount numeric NOT NULL DEFAULT 0 CHECK (bet_amount >= 0),
  player_count int NOT NULL DEFAULT 1 CHECK (player_count >= 1 AND player_count <= 4),
  current_turn_player_id uuid NULL,
  version int NOT NULL DEFAULT 0,
  move_sequence int NOT NULL DEFAULT 0,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.two_vs_two_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.two_vs_two_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('human', 'bot')),
  seat text NOT NULL CHECK (seat IN ('bottom', 'left', 'top', 'right')),
  team_id text NOT NULL CHECK (team_id IN ('teamA', 'teamB')),
  player_index int NOT NULL CHECK (player_index IN (0, 1, 2, 3)),
  is_ready boolean NOT NULL DEFAULT false,
  connected boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, seat),
  UNIQUE (room_id, player_index)
);
CREATE UNIQUE INDEX IF NOT EXISTS two_vs_two_players_unique_user
ON public.two_vs_two_players(room_id, user_id)
WHERE user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.two_vs_two_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.two_vs_two_rooms(id) ON DELETE CASCADE,
  player_id uuid REFERENCES auth.users(id),
  sequence int NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_valid boolean NOT NULL DEFAULT true,
  validation_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, sequence)
);
CREATE TABLE IF NOT EXISTS public.two_vs_two_private_states (
  room_id uuid PRIMARY KEY REFERENCES public.two_vs_two_rooms(id) ON DELETE CASCADE,
  hands jsonb NOT NULL DEFAULT '[]'::jsonb,
  boneyard jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.two_vs_two_matchmaking_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('searching', 'matched', 'cancelled')),
  matched_room_id uuid REFERENCES public.two_vs_two_rooms(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_two_vs_two_rooms_status
ON public.two_vs_two_rooms(status);
CREATE INDEX IF NOT EXISTS idx_two_vs_two_players_room_id
ON public.two_vs_two_players(room_id);
CREATE INDEX IF NOT EXISTS idx_two_vs_two_moves_room_sequence
ON public.two_vs_two_moves(room_id, sequence);
CREATE INDEX IF NOT EXISTS idx_two_vs_two_matchmaking_searching
ON public.two_vs_two_matchmaking_queue(status, created_at)
WHERE status = 'searching';
CREATE OR REPLACE FUNCTION public.set_two_vs_two_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_set_two_vs_two_rooms_updated_at
ON public.two_vs_two_rooms;
CREATE TRIGGER trigger_set_two_vs_two_rooms_updated_at
BEFORE UPDATE ON public.two_vs_two_rooms
FOR EACH ROW
EXECUTE FUNCTION public.set_two_vs_two_updated_at();
DROP TRIGGER IF EXISTS trigger_set_two_vs_two_players_updated_at
ON public.two_vs_two_players;
CREATE TRIGGER trigger_set_two_vs_two_players_updated_at
BEFORE UPDATE ON public.two_vs_two_players
FOR EACH ROW
EXECUTE FUNCTION public.set_two_vs_two_updated_at();
DROP TRIGGER IF EXISTS trigger_set_two_vs_two_private_updated_at
ON public.two_vs_two_private_states;
CREATE TRIGGER trigger_set_two_vs_two_private_updated_at
BEFORE UPDATE ON public.two_vs_two_private_states
FOR EACH ROW
EXECUTE FUNCTION public.set_two_vs_two_updated_at();
DROP TRIGGER IF EXISTS trigger_set_two_vs_two_queue_updated_at
ON public.two_vs_two_matchmaking_queue;
CREATE TRIGGER trigger_set_two_vs_two_queue_updated_at
BEFORE UPDATE ON public.two_vs_two_matchmaking_queue
FOR EACH ROW
EXECUTE FUNCTION public.set_two_vs_two_updated_at();
CREATE OR REPLACE FUNCTION public.generate_two_vs_two_room_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_code text;
  v_allowed text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  i int;
BEGIN
  LOOP
    v_code := '';

    FOR i IN 1..6 LOOP
      v_code := v_code || substr(
        v_allowed,
        floor(random() * length(v_allowed))::int + 1,
        1
      );
    END LOOP;

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.two_vs_two_rooms
      WHERE room_code = v_code
    );
  END LOOP;

  RETURN v_code;
END;
$$;
CREATE OR REPLACE FUNCTION public.resolve_two_vs_two_seat_assignment(
  p_player_index int
)
RETURNS TABLE(seat text, team_id text)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_player_index = 0 THEN
    RETURN QUERY SELECT 'bottom'::text, 'teamA'::text;

  ELSIF p_player_index = 1 THEN
    RETURN QUERY SELECT 'left'::text, 'teamB'::text;

  ELSIF p_player_index = 2 THEN
    RETURN QUERY SELECT 'top'::text, 'teamA'::text;

  ELSIF p_player_index = 3 THEN
    RETURN QUERY SELECT 'right'::text, 'teamB'::text;

  ELSE
    RAISE EXCEPTION 'Invalid 2v2 player index: %', p_player_index;
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.next_two_vs_two_move_sequence(
  p_room_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sequence int;
BEGIN
  UPDATE public.two_vs_two_rooms
  SET move_sequence = move_sequence + 1
  WHERE id = p_room_id
  RETURNING move_sequence INTO v_sequence;

  IF v_sequence IS NULL THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  RETURN v_sequence;
END;
$$;
CREATE OR REPLACE FUNCTION public.find_two_vs_two_opponent()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_count int;
  v_index int;
  v_seat text;
  v_team text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM public.two_vs_two_matchmaking_queue
  WHERE user_id = v_user_id
     OR (
       status = 'searching'
       AND created_at < now() - interval '5 minutes'
     );

  SELECT r.*
  INTO v_room
  FROM public.two_vs_two_rooms r
  WHERE r.status = 'waiting'
    AND r.player_count < 4
    AND NOT EXISTS (
      SELECT 1
      FROM public.two_vs_two_players p
      WHERE p.room_id = r.id
        AND p.user_id = v_user_id
    )
  ORDER BY r.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    SELECT COUNT(*)
    INTO v_count
    FROM public.two_vs_two_players
    WHERE room_id = v_room.id;

    v_index := v_count;

    SELECT seat, team_id
    INTO v_seat, v_team
    FROM public.resolve_two_vs_two_seat_assignment(v_index);

    INSERT INTO public.two_vs_two_players (
      room_id,
      user_id,
      kind,
      seat,
      team_id,
      player_index,
      is_ready,
      connected
    ) VALUES (
      v_room.id,
      v_user_id,
      'human',
      v_seat,
      v_team,
      v_index,
      true,
      true
    );

    UPDATE public.two_vs_two_rooms
    SET player_count = player_count + 1,
        status = CASE
          WHEN v_index + 1 = 4 THEN 'active'
          ELSE status
        END,
        version = version + 1
    WHERE id = v_room.id
    RETURNING * INTO v_room;

    INSERT INTO public.two_vs_two_moves (
      room_id,
      player_id,
      sequence,
      action,
      payload
    ) VALUES (
      v_room.id,
      v_user_id,
      public.next_two_vs_two_move_sequence(v_room.id),
      'room_joined',
      jsonb_build_object(
        'player_index', v_index,
        'seat', v_seat,
        'team_id', v_team
      )
    );

  ELSE
    INSERT INTO public.two_vs_two_rooms (
      host_user_id,
      room_code,
      status,
      bet_amount,
      player_count
    ) VALUES (
      v_user_id,
      public.generate_two_vs_two_room_code(),
      'waiting',
      0,
      1
    )
    RETURNING * INTO v_room;

    SELECT seat, team_id
    INTO v_seat, v_team
    FROM public.resolve_two_vs_two_seat_assignment(0);

    INSERT INTO public.two_vs_two_players (
      room_id,
      user_id,
      kind,
      seat,
      team_id,
      player_index,
      is_ready,
      connected
    ) VALUES (
      v_room.id,
      v_user_id,
      'human',
      v_seat,
      v_team,
      0,
      true,
      true
    );

    INSERT INTO public.two_vs_two_moves (
      room_id,
      player_id,
      sequence,
      action,
      payload
    ) VALUES (
      v_room.id,
      v_user_id,
      public.next_two_vs_two_move_sequence(v_room.id),
      'room_created',
      jsonb_build_object(
        'room_code', v_room.room_code
      )
    );
  END IF;

  INSERT INTO public.two_vs_two_matchmaking_queue (
    user_id,
    status,
    matched_room_id,
    ended_at
  ) VALUES (
    v_user_id,
    CASE
      WHEN v_room.status = 'active' THEN 'matched'
      ELSE 'searching'
    END,
    v_room.id,
    CASE
      WHEN v_room.status = 'active' THEN now()
      ELSE NULL
    END
  )
  ON CONFLICT (user_id)
  DO UPDATE
  SET status = EXCLUDED.status,
      matched_room_id = EXCLUDED.matched_room_id,
      ended_at = EXCLUDED.ended_at;

  IF v_room.status = 'active' THEN
    UPDATE public.two_vs_two_matchmaking_queue
    SET status = 'matched',
        matched_room_id = v_room.id,
        ended_at = now()
    WHERE user_id IN (
      SELECT user_id
      FROM public.two_vs_two_players
      WHERE room_id = v_room.id
    );
  END IF;

  RETURN jsonb_build_object(
    'status',
    CASE
      WHEN v_room.status = 'active' THEN 'matched'
      ELSE 'searching'
    END,
    'room_id', v_room.id,
    'room_code', v_room.room_code
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.get_two_vs_two_matchmaking_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.two_vs_two_matchmaking_queue%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_row
  FROM public.two_vs_two_matchmaking_queue
  WHERE user_id = v_user_id
    AND status IN ('searching', 'matched')
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  RETURN jsonb_build_object(
    'status', v_row.status,
    'mode', '2v2',
    'matched_room_id', v_row.matched_room_id,
    'wait_seconds',
    EXTRACT(EPOCH FROM (now() - v_row.created_at))::int
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.cancel_two_vs_two_room(
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_leaver public.two_vs_two_players%ROWTYPE;
  v_winning_team text;
  v_state jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  SELECT *
  INTO v_leaver
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id
    AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a player in this 2v2 room';
  END IF;

  UPDATE public.two_vs_two_players
  SET connected = false,
      left_at = now(),
      updated_at = now()
  WHERE id = v_leaver.id;

  IF v_room.status = 'active' THEN
    v_winning_team := CASE
      WHEN v_leaver.team_id = 'teamA' THEN 'teamB'
      ELSE 'teamA'
    END;

    v_state := COALESCE(v_room.state, '{}'::jsonb)
      || jsonb_build_object(
        'winningTeamId', v_winning_team,
        'forfeitByPlayerId', v_user_id,
        'matchReward',
        jsonb_build_object(
          'tier', 'normal',
          'gold', 6,
          'points', 20
        ),
        'canDrawTile', false
      );

    UPDATE public.two_vs_two_rooms
    SET status = 'finished',
        state = v_state,
        version = version + 1,
        updated_at = now()
    WHERE id = p_room_id;

  ELSE
    UPDATE public.two_vs_two_rooms
    SET status = 'cancelled',
        version = version + 1,
        updated_at = now()
    WHERE id = p_room_id;
  END IF;

  INSERT INTO public.two_vs_two_moves (
    room_id,
    player_id,
    sequence,
    action,
    payload
  ) VALUES (
    p_room_id,
    v_user_id,
    public.next_two_vs_two_move_sequence(p_room_id),
    CASE
      WHEN v_room.status = 'active'
      THEN 'player_forfeited'
      ELSE 'room_cancelled'
    END,
    jsonb_build_object(
      'user_id', v_user_id,
      'previous_status', v_room.status
    )
  );

  RETURN jsonb_build_object(
    'status', 'success',
    'room_id', p_room_id
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.cancel_two_vs_two_matchmaking(
  p_room_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.two_vs_two_matchmaking_queue
  SET status = 'cancelled',
      ended_at = now()
  WHERE user_id = v_user_id
    AND status IN ('searching', 'matched');

  IF p_room_id IS NOT NULL THEN
    PERFORM public.cancel_two_vs_two_room(p_room_id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'cancelled'
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.start_two_vs_two_game(
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_player_count int;
  v_initial_state jsonb;
  v_hands jsonb;
  v_boneyard jsonb := '[]'::jsonb;
  v_hand1 jsonb := '[]'::jsonb;
  v_hand2 jsonb := '[]'::jsonb;
  v_hand3 jsonb := '[]'::jsonb;
  v_hand4 jsonb := '[]'::jsonb;
  v_opening_double int := NULL;
  v_leading_player_index int := 0;
  v_current_turn_player_id uuid;
  v_shuffled_dominoes jsonb[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  IF v_room.status NOT IN ('waiting', 'active') THEN
    RAISE EXCEPTION '2v2 room is not in a valid state to start';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.two_vs_two_players
    WHERE room_id = p_room_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'You are not a player in this 2v2 room';
  END IF;

  SELECT COUNT(*)
  INTO v_player_count
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id
    AND user_id IS NOT NULL;

  IF v_player_count < 4 THEN
    RAISE EXCEPTION 'All 4 players must be present';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.two_vs_two_private_states
    WHERE room_id = p_room_id
  ) THEN
    RETURN jsonb_build_object(
      'status', 'success',
      'message', '2v2 game already started',
      'room_id', p_room_id
    );
  END IF;

  SELECT array_agg(
    jsonb_build_object(
      'id', l || '-' || r,
      'left', l,
      'right', r,
      'imageKey', l || '-' || r
    )
    ORDER BY random()
  )
  INTO v_shuffled_dominoes
  FROM generate_series(0, 6) AS l
  CROSS JOIN generate_series(l, 6) AS r;

  SELECT
    COALESCE(
      jsonb_agg(domino)
      FILTER (WHERE idx BETWEEN 1 AND 7),
      '[]'::jsonb
    ),
    COALESCE(
      jsonb_agg(domino)
      FILTER (WHERE idx BETWEEN 8 AND 14),
      '[]'::jsonb
    ),
    COALESCE(
      jsonb_agg(domino)
      FILTER (WHERE idx BETWEEN 15 AND 21),
      '[]'::jsonb
    ),
    COALESCE(
      jsonb_agg(domino)
      FILTER (WHERE idx BETWEEN 22 AND 28),
      '[]'::jsonb
    )
  INTO v_hand1, v_hand2, v_hand3, v_hand4
  FROM unnest(v_shuffled_dominoes)
  WITH ORDINALITY AS x(domino, idx);

  v_hands := jsonb_build_array(
    v_hand1,
    v_hand2,
    v_hand3,
    v_hand4
  );

  SELECT d
  INTO v_opening_double
  FROM generate_series(6, 0, -1) AS d
  WHERE v_hands @> jsonb_build_array(
    jsonb_build_array(
      jsonb_build_object(
        'left', d,
        'right', d
      )
    )
  )
  OR v_hands @> jsonb_build_array(
    jsonb_build_array(
      jsonb_build_object(
        'id', d || '-' || d
      )
    )
  )
  ORDER BY d DESC
  LIMIT 1;

  IF v_opening_double IS NOT NULL THEN
    SELECT idx - 1
    INTO v_leading_player_index
    FROM jsonb_array_elements(v_hands)
    WITH ORDINALITY AS hand(hand_json, idx)
    WHERE hand_json @> jsonb_build_array(
      jsonb_build_object(
        'left', v_opening_double,
        'right', v_opening_double
      )
    )
    OR hand_json @> jsonb_build_array(
      jsonb_build_object(
        'id', v_opening_double || '-' || v_opening_double
      )
    )
    ORDER BY idx ASC
    LIMIT 1;
  END IF;

  SELECT user_id
  INTO v_current_turn_player_id
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id
    AND player_index = v_leading_player_index
  LIMIT 1;

  INSERT INTO public.two_vs_two_private_states(
    room_id,
    hands,
    boneyard
  )
  VALUES (
    p_room_id,
    v_hands,
    v_boneyard
  );

  v_initial_state := jsonb_build_object(
    'mode', '2v2',
    'status', 'started',
    'handCounts',
    jsonb_build_array(
      jsonb_array_length(v_hand1),
      jsonb_array_length(v_hand2),
      jsonb_array_length(v_hand3),
      jsonb_array_length(v_hand4)
    ),
    'boneyardCount', 0,
    'board',
    jsonb_build_object(
      'centerTile', NULL,
      'branches',
      jsonb_build_object(
        'left',
        jsonb_build_object(
          'branch', 'left',
          'tiles', jsonb_build_array(),
          'openValue', NULL,
          'blocked', false
        ),
        'right',
        jsonb_build_object(
          'branch', 'right',
          'tiles', jsonb_build_array(),
          'openValue', NULL,
          'blocked', false
        ),
        'up',
        jsonb_build_object(
          'branch', 'up',
          'tiles', jsonb_build_array(),
          'openValue', NULL,
          'blocked', false
        ),
        'down',
        jsonb_build_object(
          'branch', 'down',
          'tiles', jsonb_build_array(),
          'openValue', NULL,
          'blocked', false
        )
      )
    ),
    'currentTurnPlayerId', v_current_turn_player_id,
    'leaderPlayerId', v_current_turn_player_id,
    'openingDouble', v_opening_double,
    'openingTileId',
    CASE
      WHEN v_opening_double IS NULL
      THEN NULL
      ELSE v_opening_double || '-' || v_opening_double
    END,
    'isFirstRound', true,
    'isOpeningRound', true,
    'spinnerValue', NULL,
    'teamScores',
    jsonb_build_object(
      'teamA', 0,
      'teamB', 0
    ),
    'roundWinnerPlayerId', NULL,
    'lastPlayedTile', NULL,
    'canDrawTile', false,
    'matchReward', NULL,
    'winningTeamId', NULL,
    'lastScoringEvent', NULL,
    'lastPassedPlayerId', NULL,
    'blockedPasses', jsonb_build_array()
  );

  UPDATE public.two_vs_two_rooms
  SET status = 'active',
      state = v_initial_state,
      current_turn_player_id = v_current_turn_player_id,
      version = version + 1,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO public.two_vs_two_moves(
    room_id,
    player_id,
    sequence,
    action,
    payload
  )
  VALUES (
    p_room_id,
    v_user_id,
    public.next_two_vs_two_move_sequence(p_room_id),
    'game_started',
    jsonb_build_object(
      'leading_player_index', v_leading_player_index,
      'opening_double', v_opening_double
    )
  );

  RETURN jsonb_build_object(
    'status', 'success',
    'room_id', p_room_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.find_two_vs_two_opponent()
TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_two_vs_two_matchmaking_status()
TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_two_vs_two_matchmaking(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_two_vs_two_room(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_two_vs_two_game(uuid)
TO authenticated;
