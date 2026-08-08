-- Make Aznif treasury wallet-backed.
-- The official admin account is the real treasury wallet. The ledger remains audit-only.

DO $$
DECLARE
  v_initial_supply numeric := 1000000000;
  v_admin_id uuid;
  v_admin_count integer;
  v_admin_before numeric := 0;
  v_admin_after numeric := 0;
  v_non_admin_wallets numeric := 0;
  v_burned_total numeric := 0;
BEGIN
  SELECT COUNT(*)
  INTO v_admin_count
  FROM public.profiles
  WHERE is_admin = true;

  IF v_admin_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one official admin account, found %', v_admin_count;
  END IF;

  SELECT id
  INTO v_admin_id
  FROM public.profiles
  WHERE is_admin = true
  LIMIT 1;

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (v_admin_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COALESCE(SUM(wallet.mc), 0)
  INTO v_non_admin_wallets
  FROM public.wallets AS wallet
  JOIN public.profiles AS profile ON profile.id = wallet.user_id
  WHERE profile.is_admin = false;

  SELECT COALESCE(SUM(tx.amount), 0)
  INTO v_burned_total
  FROM public.wallet_transactions AS tx
  WHERE tx.currency = 'MC'
    AND tx.transaction_type = 'bet_burn'
    AND tx.status = 'completed';

  v_admin_after := v_initial_supply - v_non_admin_wallets - v_burned_total;

  IF v_admin_after < 0 THEN
    RAISE EXCEPTION 'Cannot sync admin treasury wallet below zero';
  END IF;

  SELECT wallet.mc
  INTO v_admin_before
  FROM public.wallets AS wallet
  WHERE wallet.user_id = v_admin_id
  FOR UPDATE;

  UPDATE public.wallets
  SET mc = v_admin_after,
      updated_at = now()
  WHERE user_id = v_admin_id;

  IF COALESCE(v_admin_before, 0) IS DISTINCT FROM v_admin_after THEN
    INSERT INTO public.wallet_transactions(
      user_id,
      amount,
      currency,
      transaction_type,
      status,
      metadata,
      balance_before,
      balance_after
    ) VALUES (
      v_admin_id,
      abs(v_admin_after - COALESCE(v_admin_before, 0)),
      'MC',
      'admin_treasury_sync',
      'completed',
      jsonb_build_object(
        'source', '20260713000900_wallet_backed_aznif_treasury',
        'initial_supply', v_initial_supply,
        'non_admin_wallets', v_non_admin_wallets,
        'burned_total', v_burned_total,
        'note', 'Sync official admin wallet as wallet-backed treasury'
      ),
      COALESCE(v_admin_before, 0),
      v_admin_after
    );
  END IF;

  UPDATE public.aznif_treasury
  SET initial_supply = v_initial_supply,
      current_balance = v_admin_after,
      burned_total = v_burned_total,
      total_ledger_entries = (SELECT COUNT(*)::int FROM public.aznif_treasury_ledger),
      updated_at = now()
  WHERE id = true;
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_get_aznif_treasury(p_limit int DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_treasury public.aznif_treasury%ROWTYPE;
  v_admin_wallet numeric := 0;
  v_user_wallet_total numeric := 0;
  v_gross_distributed_total numeric := 0;
  v_burned_total numeric := 0;
  v_total_entries integer := 0;
  v_ledger jsonb;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_treasury
  FROM public.aznif_treasury
  WHERE id = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aznif treasury is not initialized';
  END IF;

  SELECT COALESCE(wallet.mc, 0)
  INTO v_admin_wallet
  FROM public.wallets AS wallet
  WHERE wallet.user_id = auth.uid();

  SELECT COALESCE(SUM(wallet.mc), 0)
  INTO v_user_wallet_total
  FROM public.wallets AS wallet
  JOIN public.profiles AS profile ON profile.id = wallet.user_id
  WHERE profile.is_admin = false;

  SELECT
    COALESCE(SUM(ledger.amount) FILTER (WHERE ledger.entry_type = 'distribution'), 0),
    COUNT(*)::int
  INTO v_gross_distributed_total, v_total_entries
  FROM public.aznif_treasury_ledger AS ledger;

  SELECT COALESCE(SUM(tx.amount), 0)
  INTO v_burned_total
  FROM public.wallet_transactions AS tx
  WHERE tx.currency = 'MC'
    AND tx.transaction_type = 'bet_burn'
    AND tx.status = 'completed';

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.created_at DESC), '[]'::jsonb)
  INTO v_ledger
  FROM (
    SELECT
      ledger.id,
      ledger.entry_type,
      ledger.amount,
      ledger.treasury_delta,
      ledger.user_id,
      profile.username,
      profile.player_id,
      ledger.wallet_transaction_id,
      ledger.metadata,
      ledger.created_at
    FROM public.aznif_treasury_ledger AS ledger
    LEFT JOIN public.profiles AS profile ON profile.id = ledger.user_id
    ORDER BY ledger.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  ) AS row_data;

  RETURN jsonb_build_object(
    'initialSupply', v_treasury.initial_supply,
    'currentBalance', v_admin_wallet,
    'distributedTotal', v_user_wallet_total,
    'grossDistributedTotal', v_gross_distributed_total,
    'netDistributedTotal', v_user_wallet_total,
    'burnedTotal', v_burned_total,
    'adminWalletTotal', v_admin_wallet,
    'userWalletTotal', v_user_wallet_total,
    'totalLedgerEntries', v_total_entries,
    'createdAt', v_treasury.created_at,
    'updatedAt', v_treasury.updated_at,
    'ledger', v_ledger
  );
END;
$$;
DROP FUNCTION IF EXISTS public.admin_add_aznif(uuid, numeric);
CREATE OR REPLACE FUNCTION public.admin_add_aznif(
  p_user_id uuid,
  p_amount numeric
)
RETURNS TABLE(
  credited_user_id uuid,
  previous_aznif numeric,
  new_aznif numeric,
  transaction_id uuid,
  treasury_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_admin_before numeric;
  v_admin_after numeric;
  v_user_before numeric;
  v_user_after numeric;
  v_admin_tx_id uuid;
  v_user_tx_id uuid;
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

  IF p_user_id = v_admin_id THEN
    RAISE EXCEPTION 'Cannot credit the admin treasury account';
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
  VALUES (v_admin_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (p_user_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM 1
  FROM public.wallets
  WHERE user_id IN (v_admin_id, p_user_id)
  ORDER BY user_id
  FOR UPDATE;

  SELECT wallet.mc
  INTO v_admin_before
  FROM public.wallets AS wallet
  WHERE wallet.user_id = v_admin_id;

  IF COALESCE(v_admin_before, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient Aznif treasury balance';
  END IF;

  SELECT wallet.mc
  INTO v_user_before
  FROM public.wallets AS wallet
  WHERE wallet.user_id = p_user_id;

  v_admin_after := COALESCE(v_admin_before, 0) - p_amount;
  v_user_after := COALESCE(v_user_before, 0) + p_amount;

  UPDATE public.wallets
  SET mc = v_admin_after,
      updated_at = now()
  WHERE user_id = v_admin_id;

  UPDATE public.wallets
  SET mc = v_user_after,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.wallet_transactions(
    user_id,
    from_user_id,
    to_user_id,
    amount,
    currency,
    transaction_type,
    status,
    metadata,
    balance_before,
    balance_after
  ) VALUES (
    v_admin_id,
    v_admin_id,
    p_user_id,
    p_amount,
    'MC',
    'admin_aznif_debit',
    'completed',
    jsonb_build_object('source', 'admin_web', 'reason', 'admin_add_aznif'),
    COALESCE(v_admin_before, 0),
    v_admin_after
  ) RETURNING id INTO v_admin_tx_id;

  INSERT INTO public.wallet_transactions(
    user_id,
    from_user_id,
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
    v_admin_id,
    p_user_id,
    p_amount,
    'MC',
    'admin_aznif_credit',
    'completed',
    jsonb_build_object('admin_id', v_admin_id, 'source', 'admin_web', 'treasury_balance_after', v_admin_after),
    COALESCE(v_user_before, 0),
    v_user_after
  ) RETURNING id INTO v_user_tx_id;

  INSERT INTO public.aznif_treasury_ledger(
    entry_type,
    amount,
    treasury_delta,
    user_id,
    wallet_transaction_id,
    metadata
  ) VALUES (
    'distribution',
    p_amount,
    -p_amount,
    p_user_id,
    v_user_tx_id,
    jsonb_build_object(
      'admin_id', v_admin_id,
      'admin_wallet_transaction_id', v_admin_tx_id,
      'reason', 'admin_add_aznif',
      'ledger_role', 'audit_only'
    )
  );

  UPDATE public.aznif_treasury
  SET current_balance = v_admin_after,
      total_ledger_entries = (SELECT COUNT(*)::int FROM public.aznif_treasury_ledger),
      updated_at = now()
  WHERE id = true;

  RETURN QUERY SELECT p_user_id, COALESCE(v_user_before, 0), v_user_after, v_user_tx_id, v_admin_after;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_aznif_treasury(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_add_aznif(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_aznif_treasury(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_aznif(uuid, numeric) TO authenticated;
NOTIFY pgrst, 'reload schema';
