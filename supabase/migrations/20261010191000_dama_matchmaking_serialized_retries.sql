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

  PERFORM pg_advisory_xact_lock(hashtext('dama_matchmaking'));

  SELECT * INTO v_existing
  FROM public.dama_matchmaking_queue
  WHERE user_id = v_uid AND status IN ('searching', 'matched')
  FOR UPDATE;

  IF FOUND AND v_existing.status = 'matched' THEN
    RETURN public.dama_waiting_room_status(v_existing.room_id);
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
    VALUES (v_uid, 'searching', v_now, v_now)
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'searching', room_id = NULL, updated_at = v_now;
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
    VALUES (v_uid, 'searching', v_now, v_now)
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'searching', room_id = NULL, updated_at = v_now;
    RETURN jsonb_build_object('status', 'searching', 'entryFee', 500);
  END IF;

  INSERT INTO public.dama_rooms(status, entry_fee, prize_pool, countdown_deadline_at, current_turn_color, version, state)
  VALUES ('waiting', 500, 1000, v_now + interval '5 seconds', 'cream', 0, '{}'::jsonb)
  RETURNING id INTO v_room_id;

  UPDATE public.wallets
  SET coin = coin - 500, updated_at = v_now
  WHERE user_id IN (v_uid, v_waiter.user_id);

  v_cream_player := v_waiter.user_id;
  v_black_player := v_uid;

  INSERT INTO public.dama_players(room_id, user_id, player_index, color, connected, last_seen_at)
  VALUES
    (v_room_id, v_cream_player, 0, 'cream', true, v_now),
    (v_room_id, v_black_player, 1, 'black', true, v_now);

  INSERT INTO public.dama_economy_ledger(room_id, user_id, amount, reason, idempotency_key)
  VALUES
    (v_room_id, v_cream_player, -500, 'entry_fee', v_room_id::text || ':' || v_cream_player::text || ':entry'),
    (v_room_id, v_black_player, -500, 'entry_fee', v_room_id::text || ':' || v_black_player::text || ':entry');

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
