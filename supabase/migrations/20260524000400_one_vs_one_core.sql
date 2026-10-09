CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS public.one_vs_one_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_code text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('waiting', 'active', 'finished', 'cancelled')),
  bet_amount numeric NOT NULL DEFAULT 0 CHECK (bet_amount >= 0),
  player_count int NOT NULL DEFAULT 1 CHECK (player_count >= 1 AND player_count <= 2),
  current_turn_player_id uuid NULL,
  version int NOT NULL DEFAULT 0,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.one_vs_one_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.one_vs_one_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('human', 'bot')),
  seat text NOT NULL CHECK (seat IN ('bottom', 'top')),
  team_id text NOT NULL CHECK (team_id IN ('teamA', 'teamB')),
  player_index int NOT NULL CHECK (player_index IN (0, 1)),
  is_ready boolean NOT NULL DEFAULT false,
  connected boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, seat),
  UNIQUE (room_id, player_index)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_vs_one_players_unique_user
ON public.one_vs_one_players (room_id, user_id)
WHERE user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.one_vs_one_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.one_vs_one_rooms(id) ON DELETE CASCADE,
  player_id uuid REFERENCES auth.users(id),
  sequence int NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_valid boolean NOT NULL DEFAULT true,
  validation_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_one_vs_one_rooms_status
ON public.one_vs_one_rooms(status);
CREATE INDEX IF NOT EXISTS idx_one_vs_one_players_room_id
ON public.one_vs_one_players(room_id);
CREATE INDEX IF NOT EXISTS idx_one_vs_one_moves_room_id_sequence
ON public.one_vs_one_moves(room_id, sequence);
CREATE OR REPLACE FUNCTION public.set_one_vs_one_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_set_one_vs_one_rooms_updated_at
ON public.one_vs_one_rooms;
CREATE TRIGGER trigger_set_one_vs_one_rooms_updated_at
BEFORE UPDATE ON public.one_vs_one_rooms
FOR EACH ROW
EXECUTE FUNCTION public.set_one_vs_one_updated_at();
DROP TRIGGER IF EXISTS trigger_set_one_vs_one_players_updated_at
ON public.one_vs_one_players;
CREATE TRIGGER trigger_set_one_vs_one_players_updated_at
BEFORE UPDATE ON public.one_vs_one_players
FOR EACH ROW
EXECUTE FUNCTION public.set_one_vs_one_updated_at();
CREATE OR REPLACE FUNCTION public.generate_one_vs_one_room_code()
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
      v_code := v_code || substr(v_allowed, floor(random() * length(v_allowed))::int + 1, 1);
    END LOOP;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.one_vs_one_rooms WHERE room_code = v_code
    );
  END LOOP;

  RETURN v_code;
END;
$$;
CREATE OR REPLACE FUNCTION public.next_one_vs_one_move_sequence(p_room_id uuid)
RETURNS int
LANGUAGE sql
AS $$
  SELECT COALESCE(MAX(sequence), 0) + 1
  FROM public.one_vs_one_moves
  WHERE room_id = p_room_id;
$$;
CREATE OR REPLACE FUNCTION public.resolve_one_vs_one_seat_assignment(p_player_index int)
RETURNS TABLE(seat text, team_id text)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_player_index = 0 THEN
    RETURN QUERY SELECT 'bottom'::text, 'teamA'::text;
  ELSIF p_player_index = 1 THEN
    RETURN QUERY SELECT 'top'::text, 'teamB'::text;
  ELSE
    RAISE EXCEPTION 'Invalid 1v1 player index: %', p_player_index;
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.create_one_vs_one_room(p_bet_amount numeric DEFAULT 0)
RETURNS public.one_vs_one_rooms
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_seat text;
  v_team text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_bet_amount < 0 THEN
    RAISE EXCEPTION 'bet_amount must be non-negative';
  END IF;

  INSERT INTO public.one_vs_one_rooms (
    host_user_id,
    room_code,
    status,
    bet_amount,
    player_count
  ) VALUES (
    v_user_id,
    public.generate_one_vs_one_room_code(),
    'waiting',
    p_bet_amount,
    1
  )
  RETURNING * INTO v_room;

  SELECT seat, team_id
  INTO v_seat, v_team
  FROM public.resolve_one_vs_one_seat_assignment(0);

  INSERT INTO public.one_vs_one_players (
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

  INSERT INTO public.one_vs_one_moves (
    room_id,
    player_id,
    sequence,
    action,
    payload
  ) VALUES (
    v_room.id,
    v_user_id,
    1,
    'room_created',
    jsonb_build_object(
      'room_code', v_room.room_code,
      'bet_amount', v_room.bet_amount,
      'host_user_id', v_user_id,
      'seat', v_seat,
      'team_id', v_team
    )
  );

  RETURN v_room;
END;
$$;
CREATE OR REPLACE FUNCTION public.join_one_vs_one_room(p_room_code text)
RETURNS public.one_vs_one_players
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player_count int;
  v_seat text;
  v_team text;
  v_player public.one_vs_one_players%ROWTYPE;
  v_sequence int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_room_code IS NULL OR trim(p_room_code) = '' THEN
    RAISE EXCEPTION 'room_code is required';
  END IF;

  SELECT *
  INTO v_room
  FROM public.one_vs_one_rooms
  WHERE room_code = p_room_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.status <> 'waiting' THEN
    RAISE EXCEPTION '1v1 room is not joinable';
  END IF;

  SELECT COUNT(*)
  INTO v_player_count
  FROM public.one_vs_one_players
  WHERE room_id = v_room.id;

  IF v_player_count >= 2 THEN
    RAISE EXCEPTION '1v1 room is full';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.one_vs_one_players
    WHERE room_id = v_room.id
      AND user_id = v_user_id
  ) THEN
    RETURN (
      SELECT * FROM public.one_vs_one_players
      WHERE room_id = v_room.id
        AND user_id = v_user_id
      LIMIT 1
    );
  END IF;

  SELECT seat, team_id
  INTO v_seat, v_team
  FROM public.resolve_one_vs_one_seat_assignment(v_player_count);

  INSERT INTO public.one_vs_one_players (
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
    v_player_count,
    true,
    true
  )
  RETURNING * INTO v_player;

  UPDATE public.one_vs_one_rooms
  SET
    player_count = player_count + 1,
    status = CASE WHEN v_player_count + 1 = 2 THEN 'active' ELSE status END,
    version = version + 1
  WHERE id = v_room.id;

  v_sequence := public.next_one_vs_one_move_sequence(v_room.id);

  INSERT INTO public.one_vs_one_moves (
    room_id,
    player_id,
    sequence,
    action,
    payload
  ) VALUES (
    v_room.id,
    v_user_id,
    v_sequence,
    'room_joined',
    jsonb_build_object(
      'room_code', v_room.room_code,
      'user_id', v_user_id,
      'seat', v_seat,
      'team_id', v_team,
      'player_index', v_player_count
    )
  );

  RETURN v_player;
END;
$$;
CREATE OR REPLACE FUNCTION public.start_one_vs_one_game(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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

  SELECT *
  INTO v_room
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
    SELECT 1
    FROM public.one_vs_one_players
    WHERE room_id = p_room_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'You are not a player in this 1v1 room';
  END IF;

  SELECT COUNT(*)
  INTO v_player_count
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND user_id IS NOT NULL;

  IF v_player_count < 2 THEN
    RAISE EXCEPTION 'Both 1v1 players must be present';
  END IF;

  IF v_room.state ? 'hands' THEN
    RETURN jsonb_build_object(
      'status', 'success',
      'message', '1v1 game already started',
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
  CROSS JOIN generate_series(l, 6) AS r
  WHERE NOT (l = 0 AND r = 0);

  SELECT
    COALESCE(jsonb_agg(domino) FILTER (WHERE idx BETWEEN 1 AND 9), '[]'::jsonb),
    COALESCE(jsonb_agg(domino) FILTER (WHERE idx BETWEEN 10 AND 18), '[]'::jsonb),
    COALESCE(jsonb_agg(domino) FILTER (WHERE idx > 18), '[]'::jsonb)
  INTO v_hand1, v_hand2, v_boneyard
  FROM unnest(v_shuffled_dominoes) WITH ORDINALITY AS x(domino, idx);

  v_hands := jsonb_build_array(v_hand1, v_hand2);

  SELECT d
  INTO v_opening_double
  FROM generate_series(6, 0, -1) AS d
  WHERE v_hands @> jsonb_build_array(jsonb_build_array(jsonb_build_object('left', d, 'right', d)))
     OR v_hands @> jsonb_build_array(jsonb_build_array(jsonb_build_object('id', d || '-' || d)))
  ORDER BY d DESC
  LIMIT 1;

  IF v_opening_double IS NOT NULL THEN
    SELECT idx - 1
    INTO v_leading_player_index
    FROM jsonb_array_elements(v_hands) WITH ORDINALITY AS hand(hand_json, idx)
    WHERE hand_json @> jsonb_build_array(jsonb_build_object('left', v_opening_double, 'right', v_opening_double))
       OR hand_json @> jsonb_build_array(jsonb_build_object('id', v_opening_double || '-' || v_opening_double))
    ORDER BY idx ASC
    LIMIT 1;
  END IF;

  SELECT user_id
  INTO v_current_turn_player_id
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND player_index = v_leading_player_index
  LIMIT 1;

  v_initial_state := jsonb_build_object(
    'mode', '1v1',
    'status', 'started',
    'hands', v_hands,
    'boneyard', v_boneyard,
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
    'lastPassedPlayerId', NULL
  );

  UPDATE public.one_vs_one_rooms
  SET
    status = 'active',
    state = v_initial_state,
    current_turn_player_id = v_current_turn_player_id,
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
    v_user_id,
    public.next_one_vs_one_move_sequence(p_room_id),
    'game_started',
    jsonb_build_object(
      'mode', '1v1',
      'leading_player_index', v_leading_player_index,
      'opening_double', v_opening_double,
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object(
    'status', 'success',
    'message', '1v1 game started successfully',
    'room_id', p_room_id,
    'opening_double', v_opening_double
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_one_vs_one_room(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_one_vs_one_room(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_one_vs_one_move_sequence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_one_vs_one_game(uuid) TO authenticated;
