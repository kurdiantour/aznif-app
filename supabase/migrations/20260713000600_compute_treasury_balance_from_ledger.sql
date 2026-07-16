-- Make Treasury reporting ledger-derived.
-- initial_supply remains fixed; current balance is computed from ledger deltas.

CREATE OR REPLACE FUNCTION public.admin_get_aznif_treasury(p_limit int DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_treasury public.aznif_treasury%ROWTYPE;
  v_current_balance numeric := 0;
  v_distributed_total numeric := 0;
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

  SELECT
    COALESCE(SUM(ledger.treasury_delta), 0),
    COALESCE(SUM(ledger.amount) FILTER (WHERE ledger.entry_type = 'distribution'), 0),
    COALESCE(SUM(ledger.amount) FILTER (WHERE ledger.entry_type = 'burn'), 0),
    COUNT(*)::int
  INTO v_current_balance, v_distributed_total, v_burned_total, v_total_entries
  FROM public.aznif_treasury_ledger AS ledger;

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
    'currentBalance', v_current_balance,
    'distributedTotal', v_distributed_total,
    'burnedTotal', v_burned_total,
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
  v_before numeric;
  v_after numeric;
  v_tx_id uuid;
  v_current_balance numeric;
  v_new_treasury_balance numeric;
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

  PERFORM 1
  FROM public.aznif_treasury
  WHERE id = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aznif treasury is not initialized';
  END IF;

  SELECT COALESCE(SUM(ledger.treasury_delta), 0)
  INTO v_current_balance
  FROM public.aznif_treasury_ledger AS ledger;

  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient Aznif treasury balance';
  END IF;

  v_new_treasury_balance := v_current_balance - p_amount;

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
    jsonb_build_object('admin_id', auth.uid(), 'source', 'admin_web', 'treasury_balance_after', v_new_treasury_balance),
    COALESCE(v_before, 0),
    v_after
  ) RETURNING id INTO v_tx_id;

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
    v_tx_id,
    jsonb_build_object('admin_id', auth.uid(), 'reason', 'admin_aznif_credit')
  );

  UPDATE public.aznif_treasury
  SET updated_at = now()
  WHERE id = true;

  RETURN QUERY SELECT p_user_id, COALESCE(v_before, 0), v_after, v_tx_id, v_new_treasury_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_aznif_burn_to_treasury()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted boolean := false;
BEGIN
  IF NEW.currency = 'MC'
     AND NEW.transaction_type = 'bet_burn'
     AND NEW.status = 'completed' THEN
    INSERT INTO public.aznif_treasury_ledger(
      entry_type,
      amount,
      treasury_delta,
      user_id,
      wallet_transaction_id,
      metadata,
      created_at
    ) VALUES (
      'burn',
      NEW.amount,
      0,
      NEW.user_id,
      NEW.id,
      jsonb_build_object('source', 'wallet_transaction_bet_burn', 'wallet_metadata', NEW.metadata),
      NEW.created_at
    )
    ON CONFLICT (wallet_transaction_id) DO NOTHING
    RETURNING true INTO v_inserted;

    IF COALESCE(v_inserted, false) THEN
      UPDATE public.aznif_treasury
      SET updated_at = now()
      WHERE id = true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_aznif_treasury(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_add_aznif(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_aznif_treasury(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_aznif(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';