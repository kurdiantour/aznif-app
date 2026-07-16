-- Audit normal MC transfers returned to the official admin wallet.
-- The transfer flow remains unchanged; this only records ledger audit rows.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT constraint_name
  INTO v_constraint_name
  FROM information_schema.table_constraints
  WHERE table_schema = 'public'
    AND table_name = 'aznif_treasury_ledger'
    AND constraint_type = 'CHECK'
    AND constraint_name LIKE '%entry_type%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.aznif_treasury_ledger DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE public.aznif_treasury_ledger
    ADD CONSTRAINT aznif_treasury_ledger_entry_type_check
    CHECK (entry_type IN ('initialization', 'distribution', 'spend', 'burn', 'adjustment', 'return_to_admin'));
END;
$$;

CREATE OR REPLACE FUNCTION public.record_aznif_return_to_admin_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_count integer;
  v_inserted boolean := false;
BEGIN
  IF NEW.currency <> 'MC'
     OR NEW.transaction_type <> 'transfer'
     OR NEW.status <> 'completed'
     OR NEW.from_user_id IS NULL
     OR NEW.to_user_id IS NULL
     OR NEW.user_id IS DISTINCT FROM NEW.to_user_id
     OR NEW.from_user_id = NEW.to_user_id THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_admin_count
  FROM public.profiles
  WHERE is_admin = true;

  IF v_admin_count <> 1 THEN
    RETURN NEW;
  END IF;

  SELECT id
  INTO v_admin_id
  FROM public.profiles
  WHERE is_admin = true
  LIMIT 1;

  IF NEW.to_user_id IS DISTINCT FROM v_admin_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.aznif_treasury_ledger(
    entry_type,
    amount,
    treasury_delta,
    user_id,
    wallet_transaction_id,
    metadata,
    created_at
  ) VALUES (
    'return_to_admin',
    NEW.amount,
    NEW.amount,
    NEW.from_user_id,
    NEW.id,
    jsonb_build_object(
      'admin_id', v_admin_id,
      'source', 'wallet_transaction_transfer_to_admin',
      'transfer_id', NEW.metadata ->> 'transfer_id',
      'receiver_wallet_user_id', NEW.user_id
    ),
    NEW.created_at
  )
  ON CONFLICT (wallet_transaction_id) DO NOTHING
  RETURNING true INTO v_inserted;

  IF COALESCE(v_inserted, false) THEN
    UPDATE public.aznif_treasury
    SET total_ledger_entries = (SELECT COUNT(*)::int FROM public.aznif_treasury_ledger),
        updated_at = now()
    WHERE id = true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_record_aznif_return_to_admin_ledger ON public.wallet_transactions;
CREATE TRIGGER trigger_record_aznif_return_to_admin_ledger
AFTER INSERT ON public.wallet_transactions
FOR EACH ROW
EXECUTE FUNCTION public.record_aznif_return_to_admin_ledger();

DO $$
DECLARE
  v_admin_id uuid;
  v_admin_count integer;
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

  INSERT INTO public.aznif_treasury_ledger(
    entry_type,
    amount,
    treasury_delta,
    user_id,
    wallet_transaction_id,
    metadata,
    created_at
  )
  SELECT
    'return_to_admin',
    tx.amount,
    tx.amount,
    tx.from_user_id,
    tx.id,
    jsonb_build_object(
      'admin_id', v_admin_id,
      'source', 'backfill_wallet_transaction_transfer_to_admin',
      'transfer_id', tx.metadata ->> 'transfer_id',
      'receiver_wallet_user_id', tx.user_id
    ),
    tx.created_at
  FROM public.wallet_transactions AS tx
  WHERE tx.currency = 'MC'
    AND tx.transaction_type = 'transfer'
    AND tx.status = 'completed'
    AND tx.user_id = tx.to_user_id
    AND tx.to_user_id = v_admin_id
    AND tx.from_user_id IS NOT NULL
    AND tx.from_user_id <> tx.to_user_id
  ON CONFLICT (wallet_transaction_id) DO NOTHING;

  UPDATE public.aznif_treasury
  SET total_ledger_entries = (SELECT COUNT(*)::int FROM public.aznif_treasury_ledger),
      updated_at = now()
  WHERE id = true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_aznif_return_to_admin_ledger() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
