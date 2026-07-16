ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_players(
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE(
  user_id uuid,
  email text,
  player_id text,
  username text,
  avatar_id text,
  points integer,
  games_played integer,
  games_won integer,
  games_lost integer,
  aznif numeric,
  gold numeric,
  is_admin boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.player_id,
    p.username,
    p.avatar_id,
    COALESCE(p.points, 0),
    COALESCE(p.games_played, 0),
    COALESCE(p.games_won, 0),
    COALESCE(p.games_lost, 0),
    COALESCE(w.mc, 0),
    COALESCE(w.gold, 0),
    p.is_admin,
    p.created_at,
    p.updated_at
  FROM public.profiles p
  LEFT JOIN public.wallets w ON w.user_id = p.id
  WHERE p_search IS NULL
     OR p.username ILIKE '%' || p_search || '%'
     OR p.player_id ILIKE '%' || p_search || '%'
     OR p.email ILIKE '%' || p_search || '%'
  ORDER BY p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_players(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_players(text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_player(
  p_user_id uuid,
  p_points integer,
  p_aznif numeric,
  p_gold numeric,
  p_is_admin boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_mc numeric;
  v_old_gold numeric;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_points < 0 OR p_aznif < 0 OR p_gold < 0 THEN
    RAISE EXCEPTION 'Balances and points cannot be negative';
  END IF;

  UPDATE public.profiles
  SET
    points = p_points,
    level = LEAST(5, FLOOR(GREATEST(p_points, 0) / 150)::int + 1),
    is_admin = p_is_admin,
    updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found';
  END IF;

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (p_user_id, p_aznif, p_gold, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT mc, gold
  INTO v_old_mc, v_old_gold
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  UPDATE public.wallets
  SET mc = p_aznif,
      gold = p_gold,
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
      abs(p_aznif - COALESCE(v_old_mc, 0)),
      'MC',
      'admin_adjustment',
      'completed',
      jsonb_build_object('admin_id', auth.uid()),
      COALESCE(v_old_mc, 0),
      p_aznif
    );
  END IF;

  IF v_old_gold IS DISTINCT FROM p_gold THEN
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
      abs(p_gold - COALESCE(v_old_gold, 0)),
      'Gold',
      'admin_adjustment',
      'completed',
      jsonb_build_object('admin_id', auth.uid()),
      COALESCE(v_old_gold, 0),
      p_gold
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_player(uuid, integer, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_player(uuid, integer, numeric, numeric, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

