BEGIN;

-- 1) اجازه بده room خالی واقعاً player_count = 0 داشته باشد
ALTER TABLE public.two_vs_two_rooms
DROP CONSTRAINT IF EXISTS two_vs_two_rooms_player_count_check;

ALTER TABLE public.two_vs_two_rooms
ADD CONSTRAINT two_vs_two_rooms_player_count_check
CHECK (player_count >= 0 AND player_count <= 4);


-- 2) Cancel را production-safe و idempotent می‌کنیم
CREATE OR REPLACE FUNCTION public.cancel_two_vs_two_matchmaking(
  p_room_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_party_id uuid;
  v_leader_id uuid;
  v_users uuid[];
  v_remaining_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  -- Party information, اگر کاربر داخل party باشد
  SELECT p.id, p.leader_id
  INTO v_party_id, v_leader_id
  FROM public.domino_parties p
  JOIN public.domino_party_members pm
    ON pm.party_id = p.id
  WHERE pm.user_id = v_uid
    AND p.status = 'active'
  LIMIT 1
  FOR UPDATE OF p;

  IF v_party_id IS NOT NULL THEN
    IF v_leader_id <> v_uid THEN
      RAISE EXCEPTION 'party_leader_required';
    END IF;

    SELECT array_agg(pm.user_id)
    INTO v_users
    FROM public.domino_party_members pm
    WHERE pm.party_id = v_party_id;
  ELSE
    v_users := ARRAY[v_uid];
  END IF;


  -- Room مشخص شده
  IF p_room_id IS NOT NULL THEN

    PERFORM 1
    FROM public.two_vs_two_rooms
    WHERE id = p_room_id
    FOR UPDATE;

    IF FOUND THEN

      -- بازی شروع شده را با waiting اشتباه نگیریم
      IF EXISTS (
        SELECT 1
        FROM public.two_vs_two_private_states
        WHERE room_id = p_room_id
      ) THEN
        RAISE EXCEPTION 'match_already_started';
      END IF;


      -- Membership واقعی کاربر/party حذف شود
      DELETE FROM public.two_vs_two_players
      WHERE room_id = p_room_id
        AND user_id = ANY(v_users);


      -- تعداد واقعی بازیکن‌ها
      SELECT count(*)
      INTO v_remaining_count
      FROM public.two_vs_two_players
      WHERE room_id = p_room_id;


      -- Room دقیقاً از روی membership واقعی repair شود
      UPDATE public.two_vs_two_rooms
      SET
        player_count = v_remaining_count,
        status = CASE
          WHEN v_remaining_count = 0 THEN 'cancelled'
          ELSE 'waiting'
        END,
        current_turn_player_id = NULL,
        version = version + 1,
        updated_at = now()
      WHERE id = p_room_id;


      -- هر queue stale که هنوز به همین room وصل است ولی player واقعی ندارد
      UPDATE public.two_vs_two_matchmaking_queue q
      SET
        status = 'cancelled',
        matched_room_id = NULL,
        ended_at = now(),
        updated_at = now()
      WHERE q.matched_room_id = p_room_id
        AND q.status IN ('searching', 'matched')
        AND NOT EXISTS (
          SELECT 1
          FROM public.two_vs_two_players p
          WHERE p.room_id = p_room_id
            AND p.user_id = q.user_id
        );


      -- اگر room کاملاً خالی شد، هیچ queue فعال متعلق به آن باقی نماند
      IF v_remaining_count = 0 THEN
        UPDATE public.two_vs_two_matchmaking_queue
        SET
          status = 'cancelled',
          matched_room_id = NULL,
          ended_at = now(),
          updated_at = now()
        WHERE matched_room_id = p_room_id
          AND status IN ('searching', 'matched');
      END IF;

    END IF;
  END IF;


  -- queue خود کاربر/party هم همیشه آزاد شود
  UPDATE public.two_vs_two_matchmaking_queue
  SET
    status = 'cancelled',
    matched_room_id = NULL,
    ended_at = now(),
    updated_at = now()
  WHERE user_id = ANY(v_users)
    AND status IN ('searching', 'matched');


  -- Presence
  UPDATE public.user_presence
  SET
    status = 'online_available',
    last_seen_at = now(),
    updated_at = now()
  WHERE user_id = ANY(v_users);


  -- Party state
  IF v_party_id IS NOT NULL THEN
    UPDATE public.domino_parties
    SET
      flow_status = 'idle',
      current_room_id = NULL,
      current_mode = NULL,
      current_currency = NULL,
      current_entry_fee = NULL,
      command_version = command_version + 1,
      updated_at = now()
    WHERE id = v_party_id;
  END IF;


  RETURN jsonb_build_object(
    'status', 'cancelled',
    'remaining_count', v_remaining_count
  );
END;
$$;


REVOKE ALL
ON FUNCTION public.cancel_two_vs_two_matchmaking(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.cancel_two_vs_two_matchmaking(uuid)
TO authenticated;


-- 3) یکبار دیتای خراب فعلی production را repair می‌کنیم

-- Queueهایی که searching هستند ولی membership واقعی در room ندارند
UPDATE public.two_vs_two_matchmaking_queue q
SET
  status = 'cancelled',
  matched_room_id = NULL,
  ended_at = now(),
  updated_at = now()
WHERE q.status = 'searching'
  AND q.matched_room_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.two_vs_two_players p
    WHERE p.room_id = q.matched_room_id
      AND p.user_id = q.user_id
  );


-- player_count تمام waiting/cancelled roomها را از روی players واقعی درست کن
UPDATE public.two_vs_two_rooms r
SET
  player_count = (
    SELECT count(*)
    FROM public.two_vs_two_players p
    WHERE p.room_id = r.id
  ),
  status = CASE
    WHEN (
      SELECT count(*)
      FROM public.two_vs_two_players p
      WHERE p.room_id = r.id
    ) = 0
      THEN 'cancelled'
    ELSE 'waiting'
  END,
  updated_at = now()
WHERE r.status IN ('waiting', 'cancelled');


COMMIT;