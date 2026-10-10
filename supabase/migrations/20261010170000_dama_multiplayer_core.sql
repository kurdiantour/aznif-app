-- ============================================================
-- Dama 1v1 Multiplayer Database Architecture & Lifecycle
-- Fully isolated from Domino / Okey. Mirrors Domino 1v1 robustness:
-- Realtime sync, Atomic Matchmaking, Heartbeat, Waiting Countdown,
-- Authoritative State & Moves, Concurrency Versioning,
-- Timeout & Manual Leave Takeover, and Atomic Economic Settlement.
-- ============================================================

-- 1. Main Rooms Table for Dama
CREATE TABLE IF NOT EXISTS public.dama_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'active', 'finished', 'cancelled')),
  entry_fee integer NOT NULL DEFAULT 500 CHECK (entry_fee >= 0),
  prize_pool integer NOT NULL DEFAULT 1000 CHECK (prize_pool >= 0),
  current_turn_color text CHECK (current_turn_color IN ('cream', 'black')),
  current_turn_player_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  turn_deadline_at timestamptz,
  turn_started_at timestamptz,
  version integer NOT NULL DEFAULT 0,
  countdown_deadline_at timestamptz,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  winner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  finish_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Players Table for Dama
CREATE TABLE IF NOT EXISTS public.dama_players (
  room_id uuid NOT NULL REFERENCES public.dama_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_index smallint NOT NULL CHECK (player_index IN (0, 1)),
  color text NOT NULL CHECK (color IN ('cream', 'black')),
  connected boolean NOT NULL DEFAULT true,
  bot_takeover boolean NOT NULL DEFAULT false,
  consecutive_timeout_strikes integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id),
  UNIQUE (room_id, player_index),
  UNIQUE (room_id, color)
);

-- 3. Moves Table for Dama (for Audit, Realtime replication & Resync)
CREATE TABLE IF NOT EXISTS public.dama_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.dama_rooms(id) ON DELETE CASCADE,
  player_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sequence integer NOT NULL,
  action text NOT NULL, -- 'move', 'timeout', 'takeover', 'leave', 'settle'
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, sequence)
);

-- Sequence helper for Dama moves
CREATE OR REPLACE FUNCTION public.next_dama_move_sequence(p_room_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next integer;
BEGIN
  SELECT COALESCE(MAX(sequence), 0) + 1
  INTO v_next
  FROM public.dama_moves
  WHERE room_id = p_room_id;
  RETURN v_next;
END;
$$;

-- 4. Enable RLS on all Dama tables
ALTER TABLE public.dama_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dama_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dama_moves ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dama_rooms, public.dama_players, public.dama_moves FROM PUBLIC, anon;
GRANT SELECT ON public.dama_rooms, public.dama_players, public.dama_moves TO authenticated;
GRANT ALL ON public.dama_rooms, public.dama_players, public.dama_moves TO service_role;

-- RLS Read Policies for authenticated players
DROP POLICY IF EXISTS "Players can view their own dama rooms" ON public.dama_rooms;
CREATE POLICY "Players can view their own dama rooms"
  ON public.dama_rooms FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dama_players
      WHERE dama_players.room_id = dama_rooms.id
        AND dama_players.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Players can view room players" ON public.dama_players;
CREATE POLICY "Players can view room players"
  ON public.dama_players FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dama_players dp
      WHERE dp.room_id = dama_players.room_id
        AND dp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Players can view room moves" ON public.dama_moves;
CREATE POLICY "Players can view room moves"
  ON public.dama_moves FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dama_players
      WHERE dama_players.room_id = dama_moves.room_id
        AND dama_players.user_id = auth.uid()
    )
  );

-- Enable Realtime publication for Dama
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'dama_rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dama_rooms;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'dama_players'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dama_players;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'dama_moves'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dama_moves;
  END IF;
END $$;

-- ============================================================
-- 5. Economic Settlement for Dama
-- ============================================================
CREATE OR REPLACE FUNCTION public.dama_settle_match(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.dama_rooms%ROWTYPE;
  v_winner_id uuid;
  v_loser_id uuid;
  v_prize integer;
BEGIN
  SELECT * INTO v_room
  FROM public.dama_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dama_room_not_found';
  END IF;

  IF v_room.status <> 'finished' THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'room_not_finished');
  END IF;

  -- Check if already settled
  IF EXISTS (
    SELECT 1 FROM public.dama_economy_ledger
    WHERE room_id = p_room_id AND reason = 'prize'
  ) THEN
    RETURN jsonb_build_object('settled', true, 'already_settled', true);
  END IF;

  v_winner_id := v_room.winner_user_id;
  v_prize := v_room.prize_pool;

  IF v_winner_id IS NOT NULL AND v_prize > 0 THEN
    -- Credit the prize to the winner's wallet
    UPDATE public.wallets
    SET coin = coin + v_prize,
        updated_at = clock_timestamp()
    WHERE user_id = v_winner_id;

    -- Record in ledger
    INSERT INTO public.dama_economy_ledger(room_id, user_id, amount, reason, idempotency_key)
    VALUES (
      p_room_id,
      v_winner_id,
      v_prize,
      'prize',
      p_room_id::text || ':' || v_winner_id::text || ':prize'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- Update match stats if shared table exists
    SELECT user_id INTO v_loser_id
    FROM public.dama_players
    WHERE room_id = p_room_id AND user_id <> v_winner_id
    LIMIT 1;

    RETURN jsonb_build_object('settled', true, 'winner_id', v_winner_id, 'prize', v_prize);
  ELSE
    -- Draw or no humans: refund both players if not refunded
    FOR v_loser_id IN
      SELECT user_id FROM public.dama_players WHERE room_id = p_room_id
    LOOP
      UPDATE public.wallets
      SET coin = coin + v_room.entry_fee,
          updated_at = clock_timestamp()
      WHERE user_id = v_loser_id;

      INSERT INTO public.dama_economy_ledger(room_id, user_id, amount, reason, idempotency_key)
      VALUES (
        p_room_id,
        v_loser_id,
        v_room.entry_fee,
        'refund',
        p_room_id::text || ':' || v_loser_id::text || ':draw_refund'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END LOOP;

    RETURN jsonb_build_object('settled', true, 'draw_refunded', true);
  END IF;
END;
$$;

-- ============================================================
-- 6. Dama Matchmaking & Waiting Room Functions
-- ============================================================

-- Fast, non-global-lock Matchmaking Function
CREATE OR REPLACE FUNCTION public.dama_matchmake()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.dama_matchmaking_queue%ROWTYPE;
  v_waiter public.dama_matchmaking_queue%ROWTYPE;
  v_room_id uuid;
  v_balance numeric;
  v_waiter_balance numeric;
  v_now timestamptz := clock_timestamp();
  v_cream_player uuid;
  v_black_player uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  -- 1. Check if user is already searching or matched
  SELECT * INTO v_existing
  FROM public.dama_matchmaking_queue
  WHERE user_id = v_uid AND status IN ('searching', 'matched')
  FOR UPDATE;

  IF FOUND THEN
    RETURN public.dama_waiting_room_status(v_existing.room_id);
  END IF;

  -- 2. Verify wallet balance
  SELECT coin INTO v_balance
  FROM public.wallets
  WHERE user_id = v_uid
  FOR UPDATE;

  IF COALESCE(v_balance, 0) < 500 THEN
    RAISE EXCEPTION 'insufficient_entry_balance';
  END IF;

  -- Clean old stale searchers
  DELETE FROM public.dama_matchmaking_queue
  WHERE status = 'searching' AND created_at < v_now - interval '3 minutes';

  -- 3. Match with oldest searching player using SKIP LOCKED (No global lock!)
  SELECT q.* INTO v_waiter
  FROM public.dama_matchmaking_queue q
  JOIN public.wallets w ON w.user_id = q.user_id AND w.coin >= 500
  WHERE q.status = 'searching' AND q.user_id <> v_uid
  ORDER BY q.created_at
  LIMIT 1
  FOR UPDATE OF q SKIP LOCKED;

  IF NOT FOUND THEN
    -- Put current player into queue
    INSERT INTO public.dama_matchmaking_queue(user_id, status, created_at, updated_at)
    VALUES (v_uid, 'searching', v_now, v_now)
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'searching', room_id = NULL, updated_at = v_now;

    RETURN jsonb_build_object('status', 'searching', 'entryFee', 500);
  END IF;

  -- Lock both wallets in deterministic order to avoid deadlocks
  PERFORM 1
  FROM public.wallets
  WHERE user_id IN (v_uid, v_waiter.user_id)
  ORDER BY user_id
  FOR UPDATE;

  SELECT coin INTO v_balance FROM public.wallets WHERE user_id = v_uid;
  SELECT coin INTO v_waiter_balance FROM public.wallets WHERE user_id = v_waiter.user_id;

  IF COALESCE(v_balance, 0) < 500 OR COALESCE(v_waiter_balance, 0) < 500 THEN
    UPDATE public.dama_matchmaking_queue
    SET status = 'cancelled', updated_at = v_now
    WHERE user_id = v_waiter.user_id;

    INSERT INTO public.dama_matchmaking_queue(user_id, status, created_at, updated_at)
    VALUES (v_uid, 'searching', v_now, v_now)
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'searching', room_id = NULL, updated_at = v_now;

    RETURN jsonb_build_object('status', 'searching', 'entryFee', 500);
  END IF;

  -- 4. Deduct entry fees
  UPDATE public.wallets
  SET coin = coin - 500, updated_at = v_now
  WHERE user_id IN (v_uid, v_waiter.user_id);

  -- 5. Create Dama Room with 5-second countdown deadline
  INSERT INTO public.dama_rooms(
    status, entry_fee, prize_pool, countdown_deadline_at,
    current_turn_color, version, state
  )
  VALUES (
    'waiting', 500, 1000, v_now + interval '5 seconds',
    'cream', 0, '{}'::jsonb
  )
  RETURNING id INTO v_room_id;

  -- First player (waiter) gets Cream (moves first), second gets Black
  v_cream_player := v_waiter.user_id;
  v_black_player := v_uid;

  INSERT INTO public.dama_players(room_id, user_id, player_index, color, connected, last_seen_at)
  VALUES
    (v_room_id, v_cream_player, 0, 'cream', true, v_now),
    (v_room_id, v_black_player, 1, 'black', true, v_now);

  -- Record entry fees in ledger
  INSERT INTO public.dama_economy_ledger(room_id, user_id, amount, reason, idempotency_key)
  VALUES
    (v_room_id, v_cream_player, -500, 'entry_fee', v_room_id::text || ':' || v_cream_player::text || ':entry'),
    (v_room_id, v_black_player, -500, 'entry_fee', v_room_id::text || ':' || v_black_player::text || ':entry');

  -- Update queue status
  UPDATE public.dama_matchmaking_queue
  SET status = 'matched', room_id = v_room_id, updated_at = v_now
  WHERE user_id = v_waiter.user_id;

  INSERT INTO public.dama_matchmaking_queue(user_id, status, room_id, created_at, updated_at)
  VALUES (v_uid, 'matched', v_room_id, v_now, v_now)
  ON CONFLICT (user_id) DO UPDATE
    SET status = 'matched', room_id = v_room_id, updated_at = v_now;

  RETURN public.dama_waiting_room_status(v_room_id);
END;
$$;

-- Waiting room status and heartbeat function (mirrors Domino domino_waiting_room_status)
CREATE OR REPLACE FUNCTION public.dama_waiting_room_status(p_room_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room_id uuid := p_room_id;
  v_room public.dama_rooms%ROWTYPE;
  v_players jsonb;
  v_count integer;
  v_connected integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  -- If room_id is not passed, find latest room for user
  IF v_room_id IS NULL THEN
    SELECT p.room_id INTO v_room_id
    FROM public.dama_players p
    JOIN public.dama_rooms r ON r.id = p.room_id
    WHERE p.user_id = v_uid AND r.status IN ('waiting', 'active')
    ORDER BY r.created_at DESC
    LIMIT 1;
  END IF;

  IF v_room_id IS NULL THEN
    -- Check queue
    IF EXISTS (
      SELECT 1 FROM public.dama_matchmaking_queue
      WHERE user_id = v_uid AND status = 'searching'
    ) THEN
      RETURN jsonb_build_object('status', 'searching', 'entryFee', 500);
    ELSE
      RETURN jsonb_build_object('status', 'none');
    END IF;
  END IF;

  SELECT * INTO v_room
  FROM public.dama_rooms
  WHERE id = v_room_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  -- Update caller presence/heartbeat
  UPDATE public.dama_players
  SET connected = true, last_seen_at = v_now, updated_at = v_now
  WHERE room_id = v_room_id AND user_id = v_uid;

  -- Mark players absent after 30 seconds of silence
  UPDATE public.dama_players
  SET connected = false, updated_at = v_now
  WHERE room_id = v_room_id AND connected = true
    AND last_seen_at < v_now - interval '30 seconds';

  -- Calculate connected counts
  SELECT count(*), count(*) FILTER (WHERE connected AND last_seen_at >= v_now - interval '30 seconds')
  INTO v_count, v_connected
  FROM public.dama_players
  WHERE room_id = v_room_id;

  -- If in waiting state and countdown expired with both players present, transition to active
  IF v_room.status = 'waiting'
     AND v_room.countdown_deadline_at IS NOT NULL
     AND v_room.countdown_deadline_at <= v_now
     AND v_count = 2 AND v_connected = 2 THEN

    PERFORM public.dama_start_game(v_room_id);
    SELECT * INTO v_room FROM public.dama_rooms WHERE id = v_room_id;
  END IF;

  -- Build player metadata
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'userId', dp.user_id,
        'playerIndex', dp.player_index,
        'color', dp.color,
        'username', COALESCE(p.username, 'Player'),
        'avatarId', p.avatar_id,
        'avatarUrl', p.avatar_url,
        'connected', dp.connected,
        'botTakeover', dp.bot_takeover
      )
      ORDER BY dp.player_index
    ),
    '[]'::jsonb
  ) INTO v_players
  FROM public.dama_players dp
  LEFT JOIN public.profiles p ON p.id = dp.user_id
  WHERE dp.room_id = v_room_id;

  RETURN jsonb_build_object(
    'status', v_room.status,
    'roomId', v_room.id,
    'entryFee', v_room.entry_fee,
    'prizePool', v_room.prize_pool,
    'countdownEndsAt', v_room.countdown_deadline_at,
    'currentTurnColor', v_room.current_turn_color,
    'currentTurnPlayerId', v_room.current_turn_player_id,
    'turnDeadlineAt', v_room.turn_deadline_at,
    'version', v_room.version,
    'players', v_players,
    'started', (v_room.status = 'active')
  );
END;
$$;

-- Legacy alias for compatibility with game.tsx
CREATE OR REPLACE FUNCTION public.dama_matchmaking_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.dama_waiting_room_status(NULL);
END;
$$;

-- ============================================================
-- 7. Game Start, Commit Move & Turn Management
-- ============================================================

-- Function to start Dama game from waiting room
CREATE OR REPLACE FUNCTION public.dama_start_game(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.dama_rooms%ROWTYPE;
  v_cream_user uuid;
  v_black_user uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_room
  FROM public.dama_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;

  IF v_room.status = 'active' THEN
    RETURN jsonb_build_object('success', true, 'already_started', true);
  END IF;

  SELECT user_id INTO v_cream_user
  FROM public.dama_players
  WHERE room_id = p_room_id AND color = 'cream';

  SELECT user_id INTO v_black_user
  FROM public.dama_players
  WHERE room_id = p_room_id AND color = 'black';

  IF v_cream_user IS NULL OR v_black_user IS NULL THEN
    RAISE EXCEPTION 'both_players_required';
  END IF;

  UPDATE public.dama_rooms
  SET status = 'active',
      current_turn_color = 'cream',
      current_turn_player_id = v_cream_user,
      turn_started_at = v_now,
      turn_deadline_at = v_now + interval '15 seconds',
      countdown_deadline_at = NULL,
      version = 1,
      updated_at = v_now
  WHERE id = p_room_id;

  INSERT INTO public.dama_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_cream_user,
    public.next_dama_move_sequence(p_room_id),
    'start_game',
    jsonb_build_object('cream', v_cream_user, 'black', v_black_user)
  );

  RETURN jsonb_build_object('success', true, 'status', 'active');
END;
$$;

-- Authoritative Commit Move RPC
CREATE OR REPLACE FUNCTION public.dama_commit_move(
  p_room_id uuid,
  p_expected_version integer,
  p_move jsonb,
  p_next_state jsonb,
  p_result jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room public.dama_rooms%ROWTYPE;
  v_player public.dama_players%ROWTYPE;
  v_opponent public.dama_players%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_next_turn_color text;
  v_next_turn_player_id uuid;
  v_winner_id uuid := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_room
  FROM public.dama_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;

  IF v_room.status <> 'active' THEN
    RAISE EXCEPTION 'room_not_active';
  END IF;

  -- Optimistic concurrency check
  IF v_room.version <> p_expected_version THEN
    RETURN jsonb_build_object(
      'accepted', false,
      'reason', 'stale_version',
      'current_version', v_room.version
    );
  END IF;

  SELECT * INTO v_player
  FROM public.dama_players
  WHERE room_id = p_room_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'player_not_in_room';
  END IF;

  -- Validate turn
  IF v_player.color <> v_room.current_turn_color THEN
    RETURN jsonb_build_object(
      'accepted', false,
      'reason', 'wrong_turn',
      'expected_color', v_room.current_turn_color
    );
  END IF;

  -- Reset consecutive timeouts on valid move
  UPDATE public.dama_players
  SET consecutive_timeout_strikes = 0,
      last_seen_at = v_now,
      updated_at = v_now
  WHERE room_id = p_room_id AND user_id = v_uid;

  -- Find opponent
  SELECT * INTO v_opponent
  FROM public.dama_players
  WHERE room_id = p_room_id AND user_id <> v_uid;

  -- Determine next turn
  v_next_turn_color := CASE WHEN v_player.color = 'cream' THEN 'black' ELSE 'cream' END;
  v_next_turn_player_id := v_opponent.user_id;

  -- Check if game concluded
  IF p_result IS NOT NULL AND p_result ->> 'winner' IS NOT NULL THEN
    IF p_result ->> 'winner' = v_player.color THEN
      v_winner_id := v_player.user_id;
    ELSIF p_result ->> 'winner' = v_opponent.color THEN
      v_winner_id := v_opponent.user_id;
    END IF;

    UPDATE public.dama_rooms
    SET status = 'finished',
        state = p_next_state,
        version = v_room.version + 1,
        winner_user_id = v_winner_id,
        finish_reason = p_result ->> 'reason',
        current_turn_player_id = NULL,
        turn_deadline_at = NULL,
        updated_at = v_now
    WHERE id = p_room_id;

    -- Record move
    INSERT INTO public.dama_moves(room_id, player_id, sequence, action, payload)
    VALUES (
      p_room_id,
      v_uid,
      public.next_dama_move_sequence(p_room_id),
      'move',
      jsonb_build_object('move', p_move, 'result', p_result)
    );

    -- Settle economy automatically
    PERFORM public.dama_settle_match(p_room_id);

    RETURN jsonb_build_object(
      'accepted', true,
      'finished', true,
      'winner_id', v_winner_id,
      'version', v_room.version + 1
    );
  END IF;

  -- Normal move progression
  UPDATE public.dama_rooms
  SET state = p_next_state,
      version = v_room.version + 1,
      current_turn_color = v_next_turn_color,
      current_turn_player_id = v_next_turn_player_id,
      turn_started_at = v_now,
      turn_deadline_at = v_now + interval '15 seconds',
      updated_at = v_now
  WHERE id = p_room_id;

  INSERT INTO public.dama_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_uid,
    public.next_dama_move_sequence(p_room_id),
    'move',
    jsonb_build_object('move', p_move, 'color', v_player.color)
  );

  RETURN jsonb_build_object(
    'accepted', true,
    'version', v_room.version + 1,
    'current_turn_color', v_next_turn_color,
    'current_turn_player_id', v_next_turn_player_id
  );
END;
$$;

-- ============================================================
-- 8. Timeout, Takeover & Manual Leave
-- ============================================================

-- Timeout handler: 2 consecutive strikes triggers bot takeover (mirrors Domino)
CREATE OR REPLACE FUNCTION public.dama_handle_turn_timeout(
  p_room_id uuid,
  p_expected_version integer,
  p_auto_move jsonb,
  p_next_state jsonb,
  p_result jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room public.dama_rooms%ROWTYPE;
  v_acting_player public.dama_players%ROWTYPE;
  v_opponent public.dama_players%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_strikes integer;
  v_takeover boolean := false;
  v_next_turn_color text;
  v_winner_id uuid := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_room
  FROM public.dama_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND OR v_room.status <> 'active' THEN
    RAISE EXCEPTION 'active_room_not_found';
  END IF;

  IF v_room.version <> p_expected_version THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'stale_version');
  END IF;

  -- Ensure turn has actually expired (grace period 500ms)
  IF v_room.turn_deadline_at IS NOT NULL AND v_room.turn_deadline_at > v_now - interval '500 milliseconds' THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'turn_not_expired');
  END IF;

  SELECT * INTO v_acting_player
  FROM public.dama_players
  WHERE room_id = p_room_id AND color = v_room.current_turn_color;

  SELECT * INTO v_opponent
  FROM public.dama_players
  WHERE room_id = p_room_id AND color <> v_room.current_turn_color;

  v_strikes := v_acting_player.consecutive_timeout_strikes + 1;
  IF v_strikes >= 2 THEN
    v_takeover := true;
  END IF;

  UPDATE public.dama_players
  SET consecutive_timeout_strikes = v_strikes,
      bot_takeover = CASE WHEN v_takeover THEN true ELSE bot_takeover END,
      updated_at = v_now
  WHERE room_id = p_room_id AND user_id = v_acting_player.user_id;

  -- Next turn
  v_next_turn_color := CASE WHEN v_acting_player.color = 'cream' THEN 'black' ELSE 'cream' END;

  -- Conclude game if result provided
  IF p_result IS NOT NULL AND p_result ->> 'winner' IS NOT NULL THEN
    v_winner_id := CASE
      WHEN p_result ->> 'winner' = v_acting_player.color THEN v_acting_player.user_id
      WHEN p_result ->> 'winner' = v_opponent.color THEN v_opponent.user_id
      ELSE NULL
    END;

    UPDATE public.dama_rooms
    SET status = 'finished',
        state = p_next_state,
        version = v_room.version + 1,
        winner_user_id = v_winner_id,
        finish_reason = COALESCE(p_result ->> 'reason', 'timeout'),
        current_turn_player_id = NULL,
        turn_deadline_at = NULL,
        updated_at = v_now
    WHERE id = p_room_id;

    INSERT INTO public.dama_moves(room_id, player_id, sequence, action, payload)
    VALUES (
      p_room_id,
      v_acting_player.user_id,
      public.next_dama_move_sequence(p_room_id),
      'timeout',
      jsonb_build_object('takeover', v_takeover, 'strikes', v_strikes, 'result', p_result)
    );

    PERFORM public.dama_settle_match(p_room_id);

    RETURN jsonb_build_object('accepted', true, 'finished', true, 'takeover', v_takeover);
  END IF;

  -- Advance turn
  UPDATE public.dama_rooms
  SET state = p_next_state,
      version = v_room.version + 1,
      current_turn_color = v_next_turn_color,
      current_turn_player_id = v_opponent.user_id,
      turn_started_at = v_now,
      turn_deadline_at = v_now + interval '15 seconds',
      updated_at = v_now
  WHERE id = p_room_id;

  INSERT INTO public.dama_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_acting_player.user_id,
    public.next_dama_move_sequence(p_room_id),
    'timeout',
    jsonb_build_object('auto_move', p_auto_move, 'takeover', v_takeover, 'strikes', v_strikes)
  );

  RETURN jsonb_build_object(
    'accepted', true,
    'version', v_room.version + 1,
    'takeover', v_takeover,
    'strikes', v_strikes,
    'current_turn_color', v_next_turn_color
  );
END;
$$;

-- Manual leave: forfeits match and triggers bot takeover/forfeit settlement
CREATE OR REPLACE FUNCTION public.dama_leave_match(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room public.dama_rooms%ROWTYPE;
  v_leaver public.dama_players%ROWTYPE;
  v_opponent public.dama_players%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_room
  FROM public.dama_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;

  IF v_room.status = 'finished' THEN
    RETURN jsonb_build_object('success', true, 'already_finished', true);
  END IF;

  IF v_room.status = 'waiting' THEN
    -- If room is still waiting, call cancellation & refund
    RETURN public.dama_cancel_matchmaking();
  END IF;

  SELECT * INTO v_leaver
  FROM public.dama_players
  WHERE room_id = p_room_id AND user_id = v_uid;

  SELECT * INTO v_opponent
  FROM public.dama_players
  WHERE room_id = p_room_id AND user_id <> v_uid;

  -- Mark leaver as abandoned/bot takeover
  UPDATE public.dama_players
  SET bot_takeover = true,
      connected = false,
      updated_at = v_now
  WHERE room_id = p_room_id AND user_id = v_uid;

  -- Award match victory to opponent
  UPDATE public.dama_rooms
  SET status = 'finished',
      winner_user_id = v_opponent.user_id,
      finish_reason = 'opponent_abandoned',
      current_turn_player_id = NULL,
      turn_deadline_at = NULL,
      version = v_room.version + 1,
      updated_at = v_now
  WHERE id = p_room_id;

  INSERT INTO public.dama_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_uid,
    public.next_dama_move_sequence(p_room_id),
    'leave',
    jsonb_build_object('forfeit_user_id', v_uid, 'winner_user_id', v_opponent.user_id)
  );

  PERFORM public.dama_settle_match(p_room_id);

  RETURN jsonb_build_object('success', true, 'winner_id', v_opponent.user_id);
END;
$$;

-- Reclaim seat from bot takeover when human returns (mirrors Domino restore_human_control)
CREATE OR REPLACE FUNCTION public.dama_reclaim_seat(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room public.dama_rooms%ROWTYPE;
  v_player public.dama_players%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_room
  FROM public.dama_rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;

  IF v_room.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'room_not_active');
  END IF;

  SELECT * INTO v_player
  FROM public.dama_players
  WHERE room_id = p_room_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'player_not_in_room';
  END IF;

  -- Restore player seat: disable bot takeover, clear strikes, mark connected
  UPDATE public.dama_players
  SET bot_takeover = false,
      consecutive_timeout_strikes = 0,
      connected = true,
      last_seen_at = v_now,
      updated_at = v_now
  WHERE room_id = p_room_id AND user_id = v_uid;

  INSERT INTO public.dama_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    p_room_id,
    v_uid,
    public.next_dama_move_sequence(p_room_id),
    'reclaim_seat',
    jsonb_build_object('user_id', v_uid, 'color', v_player.color)
  );

  RETURN jsonb_build_object('success', true, 'color', v_player.color);
END;
$$;

-- Grants for authenticated users
GRANT EXECUTE ON FUNCTION public.dama_matchmake() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_waiting_room_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_matchmaking_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_start_game(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_commit_move(uuid, integer, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_handle_turn_timeout(uuid, integer, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_leave_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_settle_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_reclaim_seat(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
