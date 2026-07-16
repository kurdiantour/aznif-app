-- Keep admin identities out of player management and Aznif credit flows.

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
  FROM public.profiles AS p
  LEFT JOIN public.wallets AS w ON w.user_id = p.id
  WHERE p.is_admin = false
    AND (
      p_search IS NULL
      OR p.username ILIKE '%' || p_search || '%'
      OR p.player_id ILIKE '%' || p_search || '%'
      OR p.email ILIKE '%' || p_search || '%'
    )
  ORDER BY p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_players(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_players(text, int) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_add_aznif(uuid, numeric);

CREATE OR REPLACE FUNCTION public.admin_add_aznif(
  p_user_id uuid,
  p_amount numeric
)
RETURNS TABLE(
  credited_user_id uuid,
  previous_aznif numeric,
  new_aznif numeric,
  transaction_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_tx_id uuid;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Aznif amount must be positive';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = p_user_id
      AND profile.is_admin = false
  ) THEN
    RAISE EXCEPTION 'Player not found';
  END IF;

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (p_user_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT wallet.mc
  INTO v_before
  FROM public.wallets AS wallet
  WHERE wallet.user_id = p_user_id
  FOR UPDATE;

  v_after := COALESCE(v_before, 0) + p_amount;

  UPDATE public.wallets AS wallet
  SET mc = v_after,
      updated_at = now()
  WHERE wallet.user_id = p_user_id;

  INSERT INTO public.wallet_transactions(
    user_id,
    to_user_id,
    amount,
    currency,
    transaction_type,
    status,
    metadata,
    balance_before,
    balance_after
  ) VALUES (
    p_user_id,
    p_user_id,
    p_amount,
    'MC',
    'admin_aznif_credit',
    'completed',
    jsonb_build_object('admin_id', auth.uid(), 'source', 'admin_web'),
    COALESCE(v_before, 0),
    v_after
  ) RETURNING id INTO v_tx_id;

  RETURN QUERY SELECT p_user_id, COALESCE(v_before, 0), v_after, v_tx_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_aznif(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_add_aznif(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';