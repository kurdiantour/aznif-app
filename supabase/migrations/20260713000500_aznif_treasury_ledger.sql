-- Aznif Treasury and ledger.
-- The treasury is the source of admin Aznif credits. Burned Aznif is tracked
-- separately because it is platform share removed from circulation forever.

CREATE TABLE IF NOT EXISTS public.aznif_treasury (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  initial_supply numeric NOT NULL DEFAULT 0 CHECK (initial_supply >= 0),
  current_balance numeric NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  distributed_total numeric NOT NULL DEFAULT 0 CHECK (distributed_total >= 0),
  burned_total numeric NOT NULL DEFAULT 0 CHECK (burned_total >= 0),
  total_ledger_entries integer NOT NULL DEFAULT 0 CHECK (total_ledger_entries >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.aznif_treasury_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type text NOT NULL CHECK (entry_type IN ('initialization', 'distribution', 'spend', 'burn', 'adjustment')),
  amount numeric NOT NULL CHECK (amount >= 0),
  treasury_delta numeric NOT NULL DEFAULT 0,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  wallet_transaction_id uuid UNIQUE REFERENCES public.wallet_transactions(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aznif_treasury_ledger_created
ON public.aznif_treasury_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aznif_treasury_ledger_type_created
ON public.aznif_treasury_ledger(entry_type, created_at DESC);
ALTER TABLE public.aznif_treasury ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aznif_treasury_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aznif_treasury FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.aznif_treasury_ledger FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  v_admin_mc numeric := 0;
  v_user_mc numeric := 0;
  v_burned numeric := 0;
  v_initial numeric := 0;
BEGIN
  SELECT COALESCE(SUM(w.mc), 0)
  INTO v_admin_mc
  FROM public.wallets AS w
  JOIN public.profiles AS p ON p.id = w.user_id
  WHERE p.is_admin = true;

  SELECT COALESCE(SUM(w.mc), 0)
  INTO v_user_mc
  FROM public.wallets AS w
  JOIN public.profiles AS p ON p.id = w.user_id
  WHERE p.is_admin = false;

  SELECT COALESCE(SUM(t.amount), 0)
  INTO v_burned
  FROM public.wallet_transactions AS t
  WHERE t.currency = 'MC'
    AND t.transaction_type = 'bet_burn'
    AND t.status = 'completed';

  v_initial := v_admin_mc + v_user_mc + v_burned;

  INSERT INTO public.aznif_treasury(
    id,
    initial_supply,
    current_balance,
    distributed_total,
    burned_total,
    total_ledger_entries,
    created_at,
    updated_at
  ) VALUES (
    true,
    v_initial,
    v_admin_mc,
    v_user_mc,
    v_burned,
    0,
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.aznif_treasury_ledger WHERE entry_type = 'initialization'
  ) THEN
    INSERT INTO public.aznif_treasury_ledger(entry_type, amount, treasury_delta, metadata)
    VALUES
      ('initialization', v_initial, v_initial, jsonb_build_object('source', 'migration', 'admin_wallet_mc', v_admin_mc, 'user_wallet_mc', v_user_mc, 'burned_mc', v_burned)),
      ('distribution', v_user_mc, -v_user_mc, jsonb_build_object('source', 'migration_snapshot', 'note', 'Existing non-admin wallet MC at treasury creation')),
      ('burn', v_burned, 0, jsonb_build_object('source', 'migration_snapshot', 'note', 'Existing completed bet_burn wallet transactions'));
  END IF;

  UPDATE public.aznif_treasury
  SET total_ledger_entries = (SELECT COUNT(*)::int FROM public.aznif_treasury_ledger),
      updated_at = now()
  WHERE id = true;
END $$;
CREATE OR REPLACE FUNCTION public.admin_get_aznif_treasury(p_limit int DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_treasury public.aznif_treasury%ROWTYPE;
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
    'currentBalance', v_treasury.current_balance,
    'distributedTotal', v_treasury.distributed_total,
    'burnedTotal', v_treasury.burned_total,
    'totalLedgerEntries', v_treasury.total_ledger_entries,
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
  v_treasury public.aznif_treasury%ROWTYPE;
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

  SELECT * INTO v_treasury
  FROM public.aznif_treasury
  WHERE id = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aznif treasury is not initialized';
  END IF;

  IF v_treasury.current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient Aznif treasury balance';
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

  UPDATE public.aznif_treasury
  SET current_balance = current_balance - p_amount,
      distributed_total = distributed_total + p_amount,
      total_ledger_entries = total_ledger_entries + 1,
      updated_at = now()
  WHERE id = true
  RETURNING * INTO v_treasury;

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
    jsonb_build_object('admin_id', auth.uid(), 'source', 'admin_web', 'treasury_balance_after', v_treasury.current_balance),
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

  RETURN QUERY SELECT p_user_id, COALESCE(v_before, 0), v_after, v_tx_id, v_treasury.current_balance;
END;
$$;
CREATE OR REPLACE FUNCTION public.record_aznif_burn_to_treasury()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    ON CONFLICT (wallet_transaction_id) DO NOTHING;

    UPDATE public.aznif_treasury
    SET burned_total = burned_total + NEW.amount,
        total_ledger_entries = total_ledger_entries + 1,
        updated_at = now()
    WHERE id = true
      AND EXISTS (
        SELECT 1
        FROM public.aznif_treasury_ledger AS ledger
        WHERE ledger.wallet_transaction_id = NEW.id
      );
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_record_aznif_burn_to_treasury ON public.wallet_transactions;
CREATE TRIGGER trigger_record_aznif_burn_to_treasury
AFTER INSERT ON public.wallet_transactions
FOR EACH ROW
EXECUTE FUNCTION public.record_aznif_burn_to_treasury();
REVOKE ALL ON FUNCTION public.admin_get_aznif_treasury(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_add_aznif(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_aznif_treasury(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_aznif(uuid, numeric) TO authenticated;
NOTIFY pgrst, 'reload schema';
