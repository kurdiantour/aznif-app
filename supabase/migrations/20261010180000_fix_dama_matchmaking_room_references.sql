DO $migration$
DECLARE
  v_legacy_room record;
  v_player record;
  v_refund_id uuid;
BEGIN
  FOR v_legacy_room IN
    SELECT legacy.*
    FROM public.dama_matchmaking_rooms legacy
    LEFT JOIN public.dama_rooms current_room ON current_room.id = legacy.id
    WHERE current_room.id IS NULL
  LOOP
    INSERT INTO public.dama_rooms(
      id, status, entry_fee, prize_pool, countdown_deadline_at,
      state, finish_reason, created_at, updated_at
    )
    VALUES (
      v_legacy_room.id,
      CASE WHEN v_legacy_room.status = 'completed' THEN 'finished' ELSE 'cancelled' END,
      v_legacy_room.entry_fee,
      CASE WHEN v_legacy_room.status IN ('waiting', 'active') THEN 0 ELSE v_legacy_room.prize_pool END,
      v_legacy_room.countdown_deadline_at,
      '{}'::jsonb,
      'legacy_matchmaking_migration',
      v_legacy_room.created_at,
      v_legacy_room.updated_at
    );

    INSERT INTO public.dama_players(
      room_id, user_id, player_index, color, last_seen_at, created_at, updated_at
    )
    SELECT
      player.room_id,
      player.user_id,
      player.player_index,
      player.color,
      player.created_at,
      player.created_at,
      player.created_at
    FROM public.dama_matchmaking_players player
    WHERE player.room_id = v_legacy_room.id
    ON CONFLICT (room_id, user_id) DO NOTHING;

    IF v_legacy_room.status IN ('waiting', 'active') THEN
      FOR v_player IN
        SELECT player.user_id, player.entry_fee
        FROM public.dama_matchmaking_players player
        WHERE player.room_id = v_legacy_room.id
        ORDER BY player.user_id
      LOOP
        IF EXISTS (
          SELECT 1
          FROM public.dama_economy_ledger entry
          WHERE entry.room_id = v_legacy_room.id
            AND entry.user_id = v_player.user_id
            AND entry.reason = 'entry_fee'
            AND entry.amount < 0
        ) AND NOT EXISTS (
          SELECT 1
          FROM public.dama_economy_ledger refund
          WHERE refund.room_id = v_legacy_room.id
            AND refund.user_id = v_player.user_id
            AND refund.reason = 'refund'
        ) THEN
          PERFORM 1
          FROM public.wallets
          WHERE user_id = v_player.user_id
          FOR UPDATE;

          IF NOT FOUND THEN
            RAISE EXCEPTION 'legacy_dama_refund_wallet_not_found';
          END IF;

          v_refund_id := NULL;
          INSERT INTO public.dama_economy_ledger(
            room_id, user_id, amount, reason, idempotency_key
          )
          VALUES (
            v_legacy_room.id,
            v_player.user_id,
            v_player.entry_fee,
            'refund',
            v_legacy_room.id::text || ':' || v_player.user_id::text || ':refund'
          )
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id INTO v_refund_id;

          IF v_refund_id IS NOT NULL THEN
            UPDATE public.wallets
            SET coin = coin + v_player.entry_fee,
                updated_at = clock_timestamp()
            WHERE user_id = v_player.user_id;

            IF NOT FOUND THEN
              RAISE EXCEPTION 'legacy_dama_refund_wallet_not_found';
            END IF;
          END IF;
        END IF;
      END LOOP;
    END IF;

    UPDATE public.dama_matchmaking_queue
    SET status = 'cancelled', room_id = NULL, updated_at = clock_timestamp()
    WHERE room_id = v_legacy_room.id
      AND status IN ('searching', 'matched');
  END LOOP;

  UPDATE public.dama_matchmaking_queue
  SET status = 'cancelled', updated_at = clock_timestamp()
  WHERE status = 'searching';
END;
$migration$;

ALTER TABLE public.dama_matchmaking_queue
  DROP CONSTRAINT IF EXISTS dama_matchmaking_queue_room_id_fkey;
ALTER TABLE public.dama_matchmaking_queue
  ADD CONSTRAINT dama_matchmaking_queue_room_id_fkey
  FOREIGN KEY (room_id) REFERENCES public.dama_rooms(id) ON DELETE SET NULL;

ALTER TABLE public.dama_economy_ledger
  DROP CONSTRAINT IF EXISTS dama_economy_ledger_room_id_fkey;
ALTER TABLE public.dama_economy_ledger
  ADD CONSTRAINT dama_economy_ledger_room_id_fkey
  FOREIGN KEY (room_id) REFERENCES public.dama_rooms(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.dama_cancel_matchmaking()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_queue public.dama_matchmaking_queue%ROWTYPE;
  v_room public.dama_rooms%ROWTYPE;
  v_player record;
  v_refund_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_queue
  FROM public.dama_matchmaking_queue
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND OR v_queue.status = 'cancelled' THEN
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;

  IF v_queue.room_id IS NULL THEN
    UPDATE public.dama_matchmaking_queue
    SET status = 'cancelled', updated_at = clock_timestamp()
    WHERE user_id = v_uid;
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;

  SELECT * INTO v_room
  FROM public.dama_rooms
  WHERE id = v_queue.room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.dama_matchmaking_queue
    SET status = 'cancelled', room_id = NULL, updated_at = clock_timestamp()
    WHERE room_id = v_queue.room_id;
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;

  IF v_room.status <> 'waiting' THEN
    RAISE EXCEPTION 'match_already_started';
  END IF;

  FOR v_player IN
    SELECT user_id
    FROM public.dama_players
    WHERE room_id = v_room.id
    ORDER BY user_id
    FOR UPDATE
  LOOP
    PERFORM 1
    FROM public.wallets
    WHERE user_id = v_player.user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'wallet_not_found_for_refund';
    END IF;

    v_refund_id := NULL;
    INSERT INTO public.dama_economy_ledger(room_id, user_id, amount, reason, idempotency_key)
    VALUES (
      v_room.id,
      v_player.user_id,
      v_room.entry_fee,
      'refund',
      v_room.id::text || ':' || v_player.user_id::text || ':refund'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_refund_id;

    IF v_refund_id IS NOT NULL THEN
      UPDATE public.wallets
      SET coin = coin + v_room.entry_fee,
          updated_at = clock_timestamp()
      WHERE user_id = v_player.user_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'wallet_not_found_for_refund';
      END IF;
    END IF;
  END LOOP;

  UPDATE public.dama_rooms
  SET status = 'cancelled', prize_pool = 0, updated_at = clock_timestamp()
  WHERE id = v_room.id;

  UPDATE public.dama_matchmaking_queue
  SET status = 'cancelled', room_id = NULL, updated_at = clock_timestamp()
  WHERE room_id = v_room.id AND status = 'matched';

  RETURN jsonb_build_object('status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.dama_cancel_matchmaking() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dama_cancel_matchmaking() TO authenticated;
