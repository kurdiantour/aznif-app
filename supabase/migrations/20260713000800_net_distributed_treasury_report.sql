-- Report both historical gross distribution and net remaining with users.
-- Ledger rows are not changed: distribution remains historical, burn remains separate.

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
  v_gross_distributed_total numeric := 0;
  v_net_distributed_total numeric := 0;
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
    COALESCE(SUM(ledger.treasury_delta) FILTER (WHERE ledger.entry_type <> 'burn'), 0),
    COALESCE(SUM(ledger.amount) FILTER (WHERE ledger.entry_type = 'distribution'), 0),
    COALESCE(SUM(ledger.amount) FILTER (WHERE ledger.entry_type = 'burn'), 0),
    COUNT(*)::int
  INTO v_current_balance, v_gross_distributed_total, v_burned_total, v_total_entries
  FROM public.aznif_treasury_ledger AS ledger;

  v_net_distributed_total := GREATEST(v_gross_distributed_total - v_burned_total, 0);

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
    'distributedTotal', v_net_distributed_total,
    'grossDistributedTotal', v_gross_distributed_total,
    'netDistributedTotal', v_net_distributed_total,
    'burnedTotal', v_burned_total,
    'totalLedgerEntries', v_total_entries,
    'createdAt', v_treasury.created_at,
    'updatedAt', v_treasury.updated_at,
    'ledger', v_ledger
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_aznif_treasury(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_aznif_treasury(int) TO authenticated;

NOTIFY pgrst, 'reload schema';