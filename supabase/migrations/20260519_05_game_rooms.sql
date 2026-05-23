-- Migration: game rooms and multiplayer room lifecycle
-- This migration creates the persistent room system used for real multiplayer.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- game_rooms: shared room metadata and lifecycle state
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_code text NOT NULL UNIQUE,
  mode text NOT NULL CHECK (mode IN ('1v1', '2v2')),
  status text NOT NULL CHECK (status IN ('waiting', 'active', 'finished', 'cancelled')),
  bet_amount numeric NOT NULL DEFAULT 0 CHECK (bet_amount >= 0),
  player_count int NOT NULL DEFAULT 1 CHECK (player_count >= 1),
  max_players int NOT NULL CHECK (max_players IN (2, 4)),
  current_turn_player_id uuid NULL,
  version int NOT NULL DEFAULT 0,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_rooms_host_user_id ON public.game_rooms (host_user_id);
CREATE INDEX IF NOT EXISTS idx_game_rooms_status ON public.game_rooms (status);
CREATE INDEX IF NOT EXISTS idx_game_rooms_room_code ON public.game_rooms (room_code);

CREATE TABLE IF NOT EXISTS public.game_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('human', 'bot')),
  seat text NOT NULL CHECK (seat IN ('bottom', 'left', 'top', 'right')),
  team_id text NOT NULL CHECK (team_id IN ('teamA', 'teamB')),
  player_index int NOT NULL,
  is_ready boolean NOT NULL DEFAULT false,
  connected boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, seat)
);

CREATE INDEX IF NOT EXISTS idx_game_players_game_id
ON public.game_players (game_id);

CREATE INDEX IF NOT EXISTS idx_game_players_user_id
ON public.game_players (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_players_unique_user
ON public.game_players (game_id, user_id)
WHERE user_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- game_moves: audit trail for room actions and future gameplay moves
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  player_id uuid REFERENCES auth.users(id),
  sequence int NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_valid boolean NOT NULL DEFAULT true,
  validation_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_game_moves_game_id ON public.game_moves (game_id);
CREATE INDEX IF NOT EXISTS idx_game_moves_sequence ON public.game_moves (game_id, sequence);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_game_rooms_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_game_rooms_updated_at
BEFORE UPDATE ON public.game_rooms
FOR EACH ROW
EXECUTE FUNCTION public.set_game_rooms_updated_at();

CREATE OR REPLACE FUNCTION public.set_game_players_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_game_players_updated_at
BEFORE UPDATE ON public.game_players
FOR EACH ROW
EXECUTE FUNCTION public.set_game_players_updated_at();

-- -----------------------------------------------------------------------------
-- helper functions for room lifecycle
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_room_code()
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
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.game_rooms WHERE room_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_room_seat_assignment(
  p_mode text,
  p_player_index int
)
RETURNS TABLE(seat text, team_id text)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_mode = '1v1' THEN
    IF p_player_index = 0 THEN
      RETURN QUERY SELECT 'bottom'::text, 'teamA'::text;
    ELSIF p_player_index = 1 THEN
      RETURN QUERY SELECT 'top'::text, 'teamB'::text;
    ELSE
      RAISE EXCEPTION 'Invalid player index % for mode %', p_player_index, p_mode;
    END IF;
  ELSIF p_mode = '2v2' THEN
    IF p_player_index = 0 THEN
      RETURN QUERY SELECT 'bottom'::text, 'teamA'::text;
    ELSIF p_player_index = 1 THEN
      RETURN QUERY SELECT 'left'::text, 'teamB'::text;
    ELSIF p_player_index = 2 THEN
      RETURN QUERY SELECT 'top'::text, 'teamA'::text;
    ELSIF p_player_index = 3 THEN
      RETURN QUERY SELECT 'right'::text, 'teamB'::text;
    ELSE
      RAISE EXCEPTION 'Invalid player index % for mode %', p_player_index, p_mode;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported game mode: %', p_mode;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_game_move_sequence(
  p_game_id uuid
)
RETURNS int
LANGUAGE sql
AS $$
  SELECT COALESCE(MAX(sequence), 0) + 1
  FROM public.game_moves
  WHERE game_id = p_game_id;
$$;

-- -----------------------------------------------------------------------------
-- create_room RPC: persist a waiting room and host player row
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_room(
  p_mode text,
  p_bet_amount numeric DEFAULT 0
)
RETURNS public.game_rooms
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.game_rooms%ROWTYPE;
  v_seat text;
  v_team text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_mode NOT IN ('1v1', '2v2') THEN
    RAISE EXCEPTION 'Invalid game mode';
  END IF;
  IF p_bet_amount < 0 THEN
    RAISE EXCEPTION 'bet_amount must be non-negative';
  END IF;

  INSERT INTO public.game_rooms (
    host_user_id,
    room_code,
    mode,
    status,
    bet_amount,
    player_count,
    max_players
  ) VALUES (
    v_user_id,
    public.generate_room_code(),
    p_mode,
    'waiting',
    p_bet_amount,
    1,
    CASE WHEN p_mode = '1v1' THEN 2 ELSE 4 END
  ) RETURNING * INTO v_room;

  SELECT seat, team_id
  INTO v_seat, v_team
  FROM public.resolve_room_seat_assignment(p_mode, 0);

  INSERT INTO public.game_players (
    game_id,
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

  INSERT INTO public.game_moves (
    game_id,
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
      'mode', v_room.mode,
      'bet_amount', v_room.bet_amount,
      'host_user_id', v_user_id,
      'seat', v_seat,
      'team_id', v_team
    )
  );

  RETURN v_room;
END;
$$;

-- -----------------------------------------------------------------------------
-- join_room RPC: attach an authenticated player to a waiting room
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_room(
  p_room_code text
)
RETURNS public.game_players
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.game_rooms%ROWTYPE;
  v_player_count int;
  v_seat text;
  v_team text;
  v_player public.game_players%ROWTYPE;
  v_sequence int;
  v_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_room_code IS NULL OR trim(p_room_code) = '' THEN
    RAISE EXCEPTION 'room_code is required';
  END IF;

  SELECT *
  INTO v_room
  FROM public.game_rooms
  WHERE room_code = p_room_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;
  IF v_room.status <> 'waiting' THEN
    RAISE EXCEPTION 'Room is not joinable';
  END IF;

  SELECT COUNT(*) INTO v_player_count
  FROM public.game_players
  WHERE game_id = v_room.id;

  IF v_player_count >= v_room.max_players THEN
    RAISE EXCEPTION 'Room is full';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.game_players
    WHERE game_id = v_room.id
      AND user_id = v_user_id
  ) THEN
    RETURN (
      SELECT * FROM public.game_players
      WHERE game_id = v_room.id
        AND user_id = v_user_id
      LIMIT 1
    );
  END IF;

  SELECT seat, team_id
  INTO v_seat, v_team
  FROM public.resolve_room_seat_assignment(v_room.mode, v_player_count);

  INSERT INTO public.game_players (
    game_id,
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
  ) RETURNING * INTO v_player;

  v_status := v_room.status;
  IF v_player_count + 1 = v_room.max_players THEN
    v_status := 'active';
  END IF;

  UPDATE public.game_rooms
  SET
    player_count = player_count + 1,
    status = v_status,
    current_turn_player_id = CASE
      WHEN v_status = 'active' THEN (
        SELECT user_id FROM public.game_players
        WHERE game_id = v_room.id AND player_index = 0
        LIMIT 1
      )
      ELSE current_turn_player_id
    END,
    version = version + 1
  WHERE id = v_room.id;

  v_sequence := public.next_game_move_sequence(v_room.id);

  INSERT INTO public.game_moves (
    game_id,
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

-- -----------------------------------------------------------------------------
-- Row Level Security policies for initial room system
-- -----------------------------------------------------------------------------
ALTER TABLE public.game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_moves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_rooms_select_authenticated"
ON public.game_rooms
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "game_rooms_insert_authenticated"
ON public.game_rooms
FOR INSERT
TO authenticated
WITH CHECK (host_user_id = auth.uid());

CREATE POLICY "game_rooms_update_host"
ON public.game_rooms
FOR UPDATE
TO authenticated
USING (host_user_id = auth.uid())
WITH CHECK (host_user_id = auth.uid());

CREATE POLICY "game_rooms_delete_host"
ON public.game_rooms
FOR DELETE
TO authenticated
USING (host_user_id = auth.uid());

CREATE POLICY "game_players_select_authenticated"
ON public.game_players
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "game_players_insert_authenticated"
ON public.game_players
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND kind = 'human');

CREATE POLICY "game_players_update_owner"
ON public.game_players
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "game_moves_select_authenticated"
ON public.game_moves
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "game_moves_insert_denied"
ON public.game_moves
FOR INSERT
TO authenticated
WITH CHECK (false);
