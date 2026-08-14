CREATE OR REPLACE FUNCTION public.sync_profile_level_from_points()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.level := LEAST(
    7,
    FLOOR(
      GREATEST(COALESCE(NEW.points, 0), 0)::numeric / 150
    )::integer + 1
  );

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trigger_sync_profile_level_from_points
ON public.profiles;

CREATE TRIGGER trigger_sync_profile_level_from_points
BEFORE INSERT OR UPDATE OF points
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_level_from_points();


UPDATE public.profiles
SET level = LEAST(
  7,
  FLOOR(
    GREATEST(COALESCE(points, 0), 0)::numeric / 150
  )::integer + 1
)
WHERE level IS DISTINCT FROM LEAST(
  7,
  FLOOR(
    GREATEST(COALESCE(points, 0), 0)::numeric / 150
  )::integer + 1
);


REVOKE ALL
ON FUNCTION public.sync_profile_level_from_points()
FROM PUBLIC, anon, authenticated;



-- =========================================================
-- LEADERBOARD
-- Aznif removed.
-- Gem comes from wallets.gem.
-- =========================================================

DROP FUNCTION IF EXISTS public.get_leaderboard(int);

CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_limit int DEFAULT 50
)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  avatar_id text,
  avatar_url text,
  level integer,
  points integer,
  rank bigint,
  gem numeric
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  WITH ranked_profiles AS (
    SELECT
      p.id,
      p.username AS display_name,
      p.avatar_id,
      p.avatar_url,
      COALESCE(p.points, 0) AS points,
      RANK() OVER (
        ORDER BY
          COALESCE(p.points, 0) DESC,
          p.created_at ASC,
          p.id ASC
      ) AS rank
    FROM public.profiles p
    WHERE p.leaderboard_visible = true
  )
  SELECT
    rp.id AS user_id,
    rp.display_name,
    rp.avatar_id,
    rp.avatar_url,
    LEAST(
      7,
      FLOOR(
        GREATEST(rp.points, 0)::numeric / 150
      )::integer + 1
    ) AS level,
    rp.points,
    rp.rank,
    COALESCE(w.gem, 0) AS gem
  FROM ranked_profiles rp
  LEFT JOIN public.wallets w
    ON w.user_id = rp.id
  ORDER BY
    rp.rank ASC,
    rp.points DESC,
    rp.id ASC
  LIMIT LEAST(
    GREATEST(COALESCE(p_limit, 50), 1),
    100
  );
$$;

GRANT EXECUTE
ON FUNCTION public.get_leaderboard(int)
TO authenticated, anon;



-- =========================================================
-- PUBLIC PLAYER CARD
-- Aznif = wallets.mc
-- Gem   = wallets.gem
-- =========================================================

DROP FUNCTION IF EXISTS public.get_public_player_card(uuid);
CREATE OR REPLACE FUNCTION public.get_public_player_card(
  p_player_id uuid
)
RETURNS TABLE(
  username text,
  player_id text,
  avatar_id text,
  level integer,
  points integer,
  aznif numeric,
  gems numeric,
  games_played integer,
  games_won integer,
  games_lost integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.username,
    p.player_id,
    p.avatar_id,
    LEAST(
      7,
      FLOOR(
        GREATEST(COALESCE(p.points, 0), 0)::numeric / 150
      )::integer + 1
    ) AS level,
    COALESCE(p.points, 0) AS points,
    COALESCE(w.mc, 0) AS aznif,
    COALESCE(w.gem, 0) AS gems,
    COALESCE(p.games_played, 0) AS games_played,
    COALESCE(p.games_won, 0) AS games_won,
    COALESCE(p.games_lost, 0) AS games_lost
  FROM public.profiles p
  LEFT JOIN public.wallets w
    ON w.user_id = p.id
  WHERE p.id = p_player_id;
$$;

REVOKE ALL
ON FUNCTION public.get_public_player_card(uuid)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.get_public_player_card(uuid)
TO authenticated;



-- =========================================================
-- ADMIN UPDATE PLAYER
-- Storage:
-- mc  = Aznif
-- gem = Gem
-- =========================================================

DROP FUNCTION IF EXISTS public.admin_update_player(
  uuid,
  integer,
  numeric,
  numeric
);

CREATE OR REPLACE FUNCTION public.admin_update_player(
  p_user_id uuid,
  p_points integer,
  p_aznif numeric,
  p_gem numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_mc numeric;
  v_old_gem numeric;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;


  IF p_points < 0
     OR p_aznif < 0
     OR p_gem < 0
  THEN
    RAISE EXCEPTION 'Balances and points cannot be negative';
  END IF;


  UPDATE public.profiles
  SET
    points = p_points,
    updated_at = now()
  WHERE id = p_user_id;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found';
  END IF;


  INSERT INTO public.wallets (
    user_id,
    mc,
    gem,
    updated_at
  )
  VALUES (
    p_user_id,
    p_aznif,
    p_gem,
    now()
  )
  ON CONFLICT (user_id) DO NOTHING;


  SELECT
    mc,
    gem
  INTO
    v_old_mc,
    v_old_gem
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;


  UPDATE public.wallets
  SET
    mc = p_aznif,
    gem = p_gem,
    updated_at = now()
  WHERE user_id = p_user_id;


  IF v_old_mc IS DISTINCT FROM p_aznif THEN
    INSERT INTO public.wallet_transactions(
      user_id,
      amount,
      currency,
      transaction_type,
      status,
      metadata,
      balance_before,
      balance_after
    )
    VALUES (
      p_user_id,
      ABS(p_aznif - COALESCE(v_old_mc, 0)),
      'MC',
      'admin_adjustment',
      'completed',
      jsonb_build_object(
        'admin_id',
        auth.uid()
      ),
      COALESCE(v_old_mc, 0),
      p_aznif
    );
  END IF;


  IF v_old_gem IS DISTINCT FROM p_gem THEN
    INSERT INTO public.wallet_transactions(
      user_id,
      amount,
      currency,
      transaction_type,
      status,
      metadata,
      balance_before,
      balance_after
    )
    VALUES (
      p_user_id,
      ABS(p_gem - COALESCE(v_old_gem, 0)),
      'Gem',
      'admin_adjustment',
      'completed',
      jsonb_build_object(
        'admin_id',
        auth.uid()
      ),
      COALESCE(v_old_gem, 0),
      p_gem
    );
  END IF;
END;
$$;


REVOKE ALL
ON FUNCTION public.admin_update_player(
  uuid,
  integer,
  numeric,
  numeric
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.admin_update_player(
  uuid,
  integer,
  numeric,
  numeric
)
TO authenticated;



-- =========================================================
-- FREE 2v2 MANUAL FORFEIT
-- Level is NOT manually changed.
-- Trigger derives level from points.
--
-- NOTE:
-- match_reward_records.gold is intentionally left unchanged.
-- It is NOT public.wallets.gold.
-- =========================================================

CREATE OR REPLACE FUNCTION public.settle_free_two_vs_two_manual_forfeit(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_player public.two_vs_two_players%ROWTYPE;
  v_settlement_id uuid;
  v_points_before integer;
  v_points_after integer;
BEGIN

  SELECT *
  INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;


  IF v_room.status <> 'active' THEN
    RAISE EXCEPTION
      'Manual forfeit requires an active 2v2 match';
  END IF;


  IF COALESCE(v_room.bet_amount, 0) > 0
     OR COALESCE(
       v_room.metadata ->> 'aznif_betting',
       'false'
     ) = 'true'
  THEN
    RETURN NULL;
  END IF;


  SELECT *
  INTO v_player
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND kind = 'human'
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Forfeiting human player not found';
  END IF;


  SELECT record.id
  INTO v_settlement_id
  FROM public.match_reward_records AS record
  WHERE record.room_id = p_room_id
    AND record.mode = '2v2'
    AND record.user_id = p_user_id;


  IF v_settlement_id IS NOT NULL THEN
    RETURN v_settlement_id;
  END IF;


  SELECT COALESCE(profile.points, 0)
  INTO v_points_before
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Forfeiting player profile not found';
  END IF;


  v_points_after :=
    GREATEST(0, v_points_before - 25);


  INSERT INTO public.match_reward_records (
    room_id,
    mode,
    user_id,
    team_id,
    points,
    gold,
    tier,
    source,
    metadata
  )
  VALUES (
    p_room_id,
    '2v2',
    p_user_id,
    v_player.team_id,
    0,
    0,
    'manual_forfeit',
    'manual_leave_settlement',
    jsonb_build_object(
      'result',
      'forfeit',

      'settled_at',
      'manual_leave',

      'player_index',
      v_player.player_index,

      'points_requested_delta',
      -25,

      'points_applied_delta',
      v_points_after - v_points_before,

      'points_before',
      v_points_before,

      'points_after',
      v_points_after
    )
  )
  ON CONFLICT (
    room_id,
    mode,
    user_id
  )
  DO NOTHING
  RETURNING id
  INTO v_settlement_id;


  IF v_settlement_id IS NULL THEN
    SELECT record.id
    INTO v_settlement_id
    FROM public.match_reward_records AS record
    WHERE record.room_id = p_room_id
      AND record.mode = '2v2'
      AND record.user_id = p_user_id;

    RETURN v_settlement_id;
  END IF;


  UPDATE public.profiles
  SET
    points = v_points_after,
    games_played =
      COALESCE(games_played, 0) + 1,
    games_lost =
      COALESCE(games_lost, 0) + 1
  WHERE id = p_user_id;


  RETURN v_settlement_id;
END;
$$;


REVOKE ALL
ON FUNCTION public.settle_free_two_vs_two_manual_forfeit(
  uuid,
  uuid
)
FROM PUBLIC, anon, authenticated;


GRANT EXECUTE
ON FUNCTION public.settle_free_two_vs_two_manual_forfeit(
  uuid,
  uuid
)
TO service_role;



NOTIFY pgrst, 'reload schema';