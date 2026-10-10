CREATE TABLE public.dama_matchmaking_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'active', 'cancelled', 'completed')),
  entry_fee integer NOT NULL DEFAULT 500 CHECK (entry_fee = 500),
  prize_pool integer NOT NULL DEFAULT 1000 CHECK (prize_pool >= 0),
  countdown_deadline_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.dama_matchmaking_players (
  room_id uuid NOT NULL REFERENCES public.dama_matchmaking_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_index smallint NOT NULL CHECK (player_index IN (0, 1)),
  color text NOT NULL CHECK (color IN ('cream', 'black')),
  entry_fee integer NOT NULL DEFAULT 500 CHECK (entry_fee = 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id),
  UNIQUE (room_id, player_index),
  UNIQUE (room_id, color)
);

CREATE TABLE public.dama_matchmaking_queue (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('searching', 'matched', 'cancelled')),
  room_id uuid REFERENCES public.dama_matchmaking_rooms(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dama_matchmaking_queue_search_idx
  ON public.dama_matchmaking_queue(created_at)
  WHERE status = 'searching';

CREATE TABLE public.dama_economy_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.dama_matchmaking_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount <> 0),
  reason text NOT NULL CHECK (reason IN ('entry_fee', 'refund', 'prize')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dama_matchmaking_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dama_matchmaking_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dama_matchmaking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dama_economy_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dama_matchmaking_rooms,
  public.dama_matchmaking_players,
  public.dama_matchmaking_queue,
  public.dama_economy_ledger
FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dama_matchmaking_rooms,
  public.dama_matchmaking_players,
  public.dama_matchmaking_queue,
  public.dama_economy_ledger
TO service_role;

CREATE OR REPLACE FUNCTION public.dama_matchmaking_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_queue public.dama_matchmaking_queue%ROWTYPE;
  v_room public.dama_matchmaking_rooms%ROWTYPE;
  v_players jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_queue
  FROM public.dama_matchmaking_queue
  WHERE user_id = v_uid AND status IN ('searching', 'matched')
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  IF v_queue.room_id IS NULL THEN
    RETURN jsonb_build_object('status', v_queue.status, 'entryFee', 500);
  END IF;

  SELECT * INTO v_room
  FROM public.dama_matchmaking_rooms
  WHERE id = v_queue.room_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'playerIndex', mp.player_index,
        'username', COALESCE(p.username, 'Player'),
        'avatarId', p.avatar_id,
        'avatarUrl', p.avatar_url
      )
      ORDER BY mp.player_index
    ),
    '[]'::jsonb
  ) INTO v_players
  FROM public.dama_matchmaking_players mp
  LEFT JOIN public.profiles p ON p.id = mp.user_id
  WHERE mp.room_id = v_room.id;

  RETURN jsonb_build_object(
    'status', v_queue.status,
    'roomId', v_room.id,
    'roomStatus', v_room.status,
    'entryFee', v_room.entry_fee,
    'prizePool', v_room.prize_pool,
    'countdownEndsAt', v_room.countdown_deadline_at,
    'players', v_players
  );
END;
$$;

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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('dama_matchmaking'));

  SELECT * INTO v_existing
  FROM public.dama_matchmaking_queue
  WHERE user_id = v_uid AND status IN ('searching', 'matched')
  FOR UPDATE;
  IF FOUND THEN
    RETURN public.dama_matchmaking_status();
  END IF;

  SELECT coin INTO v_balance
  FROM public.wallets
  WHERE user_id = v_uid
  FOR UPDATE;
  IF COALESCE(v_balance, 0) < 500 THEN
    RAISE EXCEPTION 'insufficient_entry_balance';
  END IF;

  DELETE FROM public.dama_matchmaking_queue
  WHERE status = 'searching' AND created_at < v_now - interval '5 minutes';

  SELECT q.* INTO v_waiter
  FROM public.dama_matchmaking_queue q
  JOIN public.wallets w ON w.user_id = q.user_id AND w.coin >= 500
  WHERE q.status = 'searching' AND q.user_id <> v_uid
  ORDER BY q.created_at
  LIMIT 1
  FOR UPDATE OF q SKIP LOCKED;

  IF NOT FOUND THEN
    INSERT INTO public.dama_matchmaking_queue(user_id, status, created_at, updated_at)
    VALUES (v_uid, 'searching', v_now, v_now);
    RETURN jsonb_build_object('status', 'searching', 'entryFee', 500);
  END IF;

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
    VALUES (v_uid, 'searching', v_now, v_now);
    RETURN jsonb_build_object('status', 'searching', 'entryFee', 500);
  END IF;

  INSERT INTO public.dama_matchmaking_rooms(status, entry_fee, prize_pool, countdown_deadline_at)
  VALUES ('waiting', 500, 1000, v_now + interval '5 seconds')
  RETURNING id INTO v_room_id;

  UPDATE public.wallets SET coin = coin - 500, updated_at = v_now
  WHERE user_id IN (v_uid, v_waiter.user_id);

  INSERT INTO public.dama_matchmaking_players(room_id, user_id, player_index, color)
  VALUES
    (v_room_id, v_waiter.user_id, 0, 'cream'),
    (v_room_id, v_uid, 1, 'black');

  INSERT INTO public.dama_economy_ledger(room_id, user_id, amount, reason, idempotency_key)
  VALUES
    (v_room_id, v_waiter.user_id, -500, 'entry_fee', v_room_id::text || ':' || v_waiter.user_id::text || ':entry'),
    (v_room_id, v_uid, -500, 'entry_fee', v_room_id::text || ':' || v_uid::text || ':entry');

  UPDATE public.dama_matchmaking_queue
  SET status = 'matched', room_id = v_room_id, updated_at = v_now
  WHERE user_id = v_waiter.user_id;
  INSERT INTO public.dama_matchmaking_queue(user_id, status, room_id, created_at, updated_at)
  VALUES (v_uid, 'matched', v_room_id, v_now, v_now);

  RETURN public.dama_matchmaking_status();
END;
$$;

CREATE OR REPLACE FUNCTION public.dama_cancel_matchmaking()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_queue public.dama_matchmaking_queue%ROWTYPE;
  v_room public.dama_matchmaking_rooms%ROWTYPE;
  v_player record;
  v_balance numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('dama_matchmaking'));

  SELECT * INTO v_queue
  FROM public.dama_matchmaking_queue
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  IF v_queue.room_id IS NOT NULL THEN
    SELECT * INTO v_room
    FROM public.dama_matchmaking_rooms
    WHERE id = v_queue.room_id
    FOR UPDATE;

    IF v_room.status <> 'waiting' THEN
      RAISE EXCEPTION 'match_already_started';
    END IF;

    FOR v_player IN
      SELECT user_id, entry_fee
      FROM public.dama_matchmaking_players
      WHERE room_id = v_room.id
      ORDER BY user_id
      FOR UPDATE
    LOOP
      SELECT coin INTO v_balance
      FROM public.wallets
      WHERE user_id = v_player.user_id
      FOR UPDATE;

      UPDATE public.wallets
      SET coin = COALESCE(v_balance, 0) + v_player.entry_fee,
          updated_at = clock_timestamp()
      WHERE user_id = v_player.user_id;

      INSERT INTO public.dama_economy_ledger(room_id, user_id, amount, reason, idempotency_key)
      VALUES (
        v_room.id,
        v_player.user_id,
        v_player.entry_fee,
        'refund',
        v_room.id::text || ':' || v_player.user_id::text || ':refund'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END LOOP;

    UPDATE public.dama_matchmaking_rooms
    SET status = 'cancelled', prize_pool = 0, updated_at = clock_timestamp()
    WHERE id = v_room.id;
    UPDATE public.dama_matchmaking_queue
    SET status = 'cancelled', updated_at = clock_timestamp()
    WHERE room_id = v_room.id AND status = 'matched';
  ELSE
    UPDATE public.dama_matchmaking_queue
    SET status = 'cancelled', updated_at = clock_timestamp()
    WHERE user_id = v_uid;
  END IF;

  RETURN jsonb_build_object('status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.dama_matchmaking_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dama_matchmake() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dama_cancel_matchmaking() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dama_matchmaking_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_matchmake() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dama_cancel_matchmaking() TO authenticated;
