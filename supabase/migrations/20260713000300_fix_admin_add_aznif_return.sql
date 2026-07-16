-- Keep the Aznif credit RPC simple and avoid ambiguous output names.

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

  IF NOT EXISTS (SELECT 1 FROM public.profiles AS profile WHERE profile.id = p_user_id) THEN
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