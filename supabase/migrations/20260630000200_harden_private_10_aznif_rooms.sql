-- Release hardening for fixed-price private 1v1 rooms.
-- Public 1/5 Aznif matchmaking and free Lobby matchmaking are unchanged.

ALTER TABLE public.one_vs_one_rooms
ADD COLUMN IF NOT EXISTS private_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_one_vs_one_private_waiting_expiry
ON public.one_vs_one_rooms(private_expires_at)
WHERE status = 'waiting' AND private_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.one_vs_one_private_join_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  normalized_code text NOT NULL,
  success boolean NOT NULL DEFAULT false,
  room_id uuid REFERENCES public.one_vs_one_rooms(id) ON DELETE SET NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_private_join_attempts_user_time
ON public.one_vs_one_private_join_attempts(user_id, attempted_at DESC);

ALTER TABLE public.one_vs_one_private_join_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.one_vs_one_private_join_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_one_active_paid_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_is_paid boolean;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  SELECT room.bet_amount > 0 AND room.status IN ('waiting', 'active')
  INTO v_target_is_paid
  FROM public.one_vs_one_rooms AS room
  WHERE room.id = NEW.room_id;

  IF COALESCE(v_target_is_paid, false) = false THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 10));
  IF EXISTS (
    SELECT 1
    FROM public.one_vs_one_players AS player
    JOIN public.one_vs_one_rooms AS room ON room.id = player.room_id
    WHERE player.user_id = NEW.user_id
      AND room.id <> NEW.room_id
      AND room.bet_amount > 0
      AND room.status IN ('waiting', 'active')
  ) THEN
    RAISE EXCEPTION 'User already has an active paid room';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_one_active_paid_room
ON public.one_vs_one_players;
CREATE TRIGGER trigger_enforce_one_active_paid_room
BEFORE INSERT OR UPDATE OF user_id, room_id ON public.one_vs_one_players
FOR EACH ROW EXECUTE FUNCTION public.enforce_one_active_paid_room();

CREATE OR REPLACE FUNCTION public.expire_stale_private_10_aznif_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired_ids uuid[];
BEGIN
  SELECT array_agg(expired.id) INTO v_expired_ids
  FROM (
    SELECT room.id
    FROM public.one_vs_one_rooms AS room
    WHERE room.status = 'waiting'
      AND room.bet_amount = 10
      AND room.metadata ->> 'source' = 'private_room_10'
      AND (
        room.private_expires_at <= now()
        OR COALESCE((room.metadata ->> 'host_last_seen_at')::timestamptz, room.created_at)
           < now() - interval '45 seconds'
      )
    FOR UPDATE
  ) AS expired;

  IF COALESCE(array_length(v_expired_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.one_vs_one_rooms
  SET status = 'cancelled',
      version = version + 1,
      metadata = metadata || jsonb_build_object('cancel_reason', 'private_room_expired'),
      updated_at = now()
  WHERE id = ANY(v_expired_ids);

  UPDATE public.one_vs_one_players
  SET connected = false, left_at = COALESCE(left_at, now()), updated_at = now()
  WHERE room_id = ANY(v_expired_ids);

  RETURN array_length(v_expired_ids, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_private_10_aznif_room()
RETURNS public.one_vs_one_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_wallet_mc numeric;
  v_seat text;
  v_team text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  -- A separate lock namespace serializes rate-limit counters without
  -- interfering with the paid-room membership locks below.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 11));
  PERFORM public.expire_stale_private_10_aznif_rooms();

  IF EXISTS (
    SELECT 1
    FROM public.one_vs_one_players AS player
    JOIN public.one_vs_one_rooms AS room ON room.id = player.room_id
    WHERE player.user_id = v_user_id
      AND room.bet_amount > 0
      AND room.status IN ('waiting', 'active')
  ) THEN
    RAISE EXCEPTION 'User already has an active paid room';
  END IF;

  SELECT wallet.mc INTO v_wallet_mc
  FROM public.wallets AS wallet
  WHERE wallet.user_id = v_user_id
  FOR UPDATE;
  IF COALESCE(v_wallet_mc, 0) < 10 THEN RAISE EXCEPTION 'Insufficient MC balance'; END IF;

  INSERT INTO public.one_vs_one_rooms (
    host_user_id, room_code, status, bet_amount, player_count,
    metadata, private_expires_at
  ) VALUES (
    v_user_id, public.generate_one_vs_one_room_code(), 'waiting', 10, 1,
    jsonb_build_object(
      'aznif_betting', true,
      'source', 'private_room_10',
      'host_last_seen_at', now()
    ),
    now() + interval '10 minutes'
  ) RETURNING * INTO v_room;

  SELECT seat, team_id INTO v_seat, v_team
  FROM public.resolve_one_vs_one_seat_assignment(0);

  INSERT INTO public.one_vs_one_players (
    room_id, user_id, kind, seat, team_id, player_index, is_ready, connected
  ) VALUES (
    v_room.id, v_user_id, 'human', v_seat, v_team, 0, true, true
  );

  INSERT INTO public.one_vs_one_moves (
    room_id, player_id, sequence, action, payload
  ) VALUES (
    v_room.id, v_user_id, public.next_one_vs_one_move_sequence(v_room.id),
    'room_created',
    jsonb_build_object(
      'room_code', v_room.room_code, 'bet_amount', 10,
      'aznif_betting', true, 'source', 'private_room_10',
      'host_user_id', v_user_id, 'seat', v_seat, 'team_id', v_team
    )
  );

  RETURN v_room;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_private_10_aznif_room(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.expire_stale_private_10_aznif_rooms();

  UPDATE public.one_vs_one_rooms
  SET metadata = metadata || jsonb_build_object('host_last_seen_at', now()),
      updated_at = now()
  WHERE id = p_room_id
    AND host_user_id = v_user_id
    AND status = 'waiting'
    AND bet_amount = 10
    AND metadata ->> 'source' = 'private_room_10';

  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

CREATE OR REPLACE FUNCTION public.join_private_10_aznif_room(p_room_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_code text := upper(trim(COALESCE(p_room_code, '')));
  v_attempt_id bigint;
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
  v_player_count integer;
  v_host_mc numeric;
  v_joiner_mc numeric;
  v_seat text;
  v_team text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 10));
  PERFORM public.expire_stale_private_10_aznif_rooms();

  DELETE FROM public.one_vs_one_private_join_attempts
  WHERE attempted_at < now() - interval '1 day';

  IF (
    SELECT count(*) FROM public.one_vs_one_private_join_attempts
    WHERE user_id = v_user_id AND attempted_at > now() - interval '5 minutes'
  ) >= 8 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'rate_limited');
  END IF;

  INSERT INTO public.one_vs_one_private_join_attempts(user_id, normalized_code)
  VALUES (v_user_id, left(v_code, 32))
  RETURNING id INTO v_attempt_id;

  IF v_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_code');
  END IF;

  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE room_code = v_code
    AND bet_amount = 10
    AND metadata ->> 'aznif_betting' = 'true'
    AND metadata ->> 'source' = 'private_room_10';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_code');
  END IF;

  -- Serialize all paid-room membership decisions for both users before
  -- locking the room row, preventing cross-flow races with public paid rooms.
  PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(v_room.host_user_id, v_user_id)::text, 10));
  PERFORM pg_advisory_xact_lock(hashtextextended(GREATEST(v_room.host_user_id, v_user_id)::text, 10));

  SELECT * INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = v_room.id
    AND bet_amount = 10
    AND metadata ->> 'aznif_betting' = 'true'
    AND metadata ->> 'source' = 'private_room_10'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_code');
  END IF;
  IF v_room.host_user_id = v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'cannot_join_own_room');
  END IF;
  IF v_room.status <> 'waiting' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'not_joinable');
  END IF;
  IF v_room.private_expires_at <= now() THEN
    UPDATE public.one_vs_one_rooms SET status = 'cancelled', version = version + 1 WHERE id = v_room.id;
    RETURN jsonb_build_object('ok', false, 'error_code', 'expired');
  END IF;
  IF COALESCE((v_room.metadata ->> 'host_last_seen_at')::timestamptz, v_room.created_at)
       < now() - interval '45 seconds' THEN
    UPDATE public.one_vs_one_rooms SET status = 'cancelled', version = version + 1 WHERE id = v_room.id;
    RETURN jsonb_build_object('ok', false, 'error_code', 'host_unavailable');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.one_vs_one_players AS player
    JOIN public.one_vs_one_rooms AS room ON room.id = player.room_id
    WHERE player.user_id = v_user_id
      AND room.id <> v_room.id
      AND room.bet_amount > 0
      AND room.status IN ('waiting', 'active')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'already_in_paid_room');
  END IF;

  PERFORM 1 FROM public.wallets
  WHERE user_id IN (v_room.host_user_id, v_user_id)
  ORDER BY user_id FOR UPDATE;
  SELECT mc INTO v_host_mc FROM public.wallets WHERE user_id = v_room.host_user_id;
  SELECT mc INTO v_joiner_mc FROM public.wallets WHERE user_id = v_user_id;
  IF COALESCE(v_host_mc, 0) < 10 OR COALESCE(v_joiner_mc, 0) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'insufficient_aznif');
  END IF;

  SELECT count(*) INTO v_player_count
  FROM public.one_vs_one_players WHERE room_id = v_room.id;
  IF v_player_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'not_joinable');
  END IF;

  SELECT seat, team_id INTO v_seat, v_team
  FROM public.resolve_one_vs_one_seat_assignment(1);
  INSERT INTO public.one_vs_one_players (
    room_id, user_id, kind, seat, team_id, player_index, is_ready, connected
  ) VALUES (
    v_room.id, v_user_id, 'human', v_seat, v_team, 1, true, true
  ) RETURNING * INTO v_player;

  UPDATE public.one_vs_one_rooms
  SET player_count = 2, status = 'active', version = version + 1, updated_at = now()
  WHERE id = v_room.id;

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (
    v_room.id, v_user_id, public.next_one_vs_one_move_sequence(v_room.id),
    'room_joined',
    jsonb_build_object(
      'room_code', v_room.room_code, 'user_id', v_user_id,
      'seat', v_seat, 'team_id', v_team, 'player_index', 1,
      'bet_amount', 10, 'aznif_betting', true
    )
  );

  UPDATE public.one_vs_one_private_join_attempts
  SET success = true, room_id = v_room.id
  WHERE id = v_attempt_id;

  RETURN jsonb_build_object(
    'ok', true, 'room_id', v_room.id, 'room_code', v_room.room_code,
    'bet_amount', 10
  );
END;
$$;

-- The generic arbitrary-amount private creator/joiner are internal only now.
REVOKE ALL ON FUNCTION public.create_one_vs_one_room(numeric)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.join_one_vs_one_room(text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_one_vs_one_room(numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_one_vs_one_room(text) TO service_role;

REVOKE ALL ON FUNCTION public.expire_stale_private_10_aznif_rooms()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_one_active_paid_room()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_private_10_aznif_room()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.join_private_10_aznif_room(text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_private_10_aznif_room(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.expire_stale_private_10_aznif_rooms() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_private_10_aznif_room() TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_private_10_aznif_room(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_private_10_aznif_room(uuid) TO authenticated;

-- Presence heartbeats provide a lightweight global cleanup clock. Going to
-- the background also cancels a hosted waiting room immediately when the OS
-- delivers the AppState transition.
CREATE OR REPLACE FUNCTION public.update_my_presence(p_status text)
RETURNS public.user_presence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_presence public.user_presence%ROWTYPE;
  v_cancelled_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_status NOT IN ('online_available', 'matchmaking', 'in_game', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status';
  END IF;

  PERFORM public.expire_stale_private_10_aznif_rooms();

  IF p_status = 'away' THEN
    WITH cancelled AS (
      UPDATE public.one_vs_one_rooms
      SET status = 'cancelled',
          version = version + 1,
          metadata = metadata || jsonb_build_object('cancel_reason', 'host_went_away'),
          updated_at = now()
      WHERE host_user_id = auth.uid()
        AND status = 'waiting'
        AND bet_amount = 10
        AND metadata ->> 'source' = 'private_room_10'
      RETURNING id
    )
    SELECT array_agg(id) INTO v_cancelled_ids FROM cancelled;

    UPDATE public.one_vs_one_players
    SET connected = false, left_at = COALESCE(left_at, now()), updated_at = now()
    WHERE room_id = ANY(COALESCE(v_cancelled_ids, ARRAY[]::uuid[]));
  END IF;

  INSERT INTO public.user_presence(user_id, status, last_seen_at, updated_at)
  VALUES (auth.uid(), p_status, now(), now())
  ON CONFLICT (user_id) DO UPDATE
  SET status = EXCLUDED.status, last_seen_at = now(), updated_at = now()
  RETURNING * INTO v_presence;

  RETURN v_presence;
END;
$$;
