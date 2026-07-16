-- Remove admin role mutation from admin player updates.
-- is_admin remains only for authenticating existing admins via current_user_is_admin().

CREATE OR REPLACE FUNCTION public.admin_update_player(
  p_user_id uuid,
  p_points integer,
  p_aznif numeric,
  p_gold numeric
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

DROP FUNCTION IF EXISTS public.admin_update_player(uuid, integer, numeric, numeric, boolean);
REVOKE ALL ON FUNCTION public.admin_update_player(uuid, integer, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_player(uuid, integer, numeric, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
