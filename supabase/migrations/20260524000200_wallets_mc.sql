-- Migration: wallets + MC functions
-- Creates wallets and wallet_transactions tables and MC-specific functions

CREATE TABLE IF NOT EXISTS public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mc numeric NOT NULL DEFAULT 0 CHECK (mc >= 0),
  gold numeric NOT NULL DEFAULT 0 CHECK (gold >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id
ON public.wallets (user_id);

CREATE INDEX IF NOT EXISTS idx_wallets_updated_at
ON public.wallets (updated_at);

-- Wallet transactions table (both currencies)
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  from_user_id uuid REFERENCES auth.users(id),
  to_user_id uuid REFERENCES auth.users(id),
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('MC','Gold')),
  transaction_type text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  metadata jsonb DEFAULT '{}'::jsonb,
  balance_before numeric NOT NULL,
  balance_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_id
ON public.wallet_transactions (user_id);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_created_at
ON public.wallet_transactions (created_at);

-- Simple RLS
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own wallet" ON public.wallets;

CREATE POLICY "Users can view own wallet"
ON public.wallets
FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own wallet" ON public.wallets;

CREATE POLICY "Users can insert own wallet"
ON public.wallets
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own transactions" ON public.wallet_transactions;

CREATE POLICY "Users can view own transactions"
ON public.wallet_transactions
FOR SELECT
USING (user_id = auth.uid());

GRANT SELECT ON public.wallets TO authenticated;
GRANT INSERT ON public.wallets TO authenticated;
GRANT SELECT ON public.wallet_transactions TO authenticated;

-- Ensure wallets row exists for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_wallets()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (NEW.id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_handle_new_user_wallets ON auth.users;

CREATE TRIGGER trigger_handle_new_user_wallets
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user_wallets();

-- Update MC balance helper
CREATE OR REPLACE FUNCTION public.update_mc_balance(
  p_user_id uuid,
  p_delta numeric
)
RETURNS TABLE(user_id uuid, mc numeric, gold numeric, updated_at timestamptz)
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet public.wallets%rowtype;
  v_new_mc numeric;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
  INTO v_wallet
  FROM public.wallets
  WHERE wallets.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_delta < 0 THEN
      RAISE EXCEPTION 'Insufficient MC balance';
    END IF;

    INSERT INTO public.wallets (user_id, mc, gold, updated_at)
    VALUES (p_user_id, p_delta, 0, now())
    RETURNING * INTO v_wallet;
  ELSE
    v_new_mc := v_wallet.mc + p_delta;

    IF v_new_mc < 0 THEN
      RAISE EXCEPTION 'Insufficient MC balance';
    END IF;

    UPDATE public.wallets
    SET mc = v_new_mc,
        updated_at = now()
    WHERE user_id = p_user_id
    RETURNING * INTO v_wallet;
  END IF;

  RETURN QUERY
  SELECT v_wallet.user_id, v_wallet.mc, v_wallet.gold, v_wallet.updated_at;
END;
$$;

-- MC transfer
CREATE OR REPLACE FUNCTION public.transfer_mc(
  p_from uuid,
  p_to uuid,
  p_amount numeric
)
RETURNS TABLE(tx_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  v_before_from numeric;
  v_after_from numeric;
  v_before_to numeric;
  v_after_to numeric;
  v_tx_id uuid;
BEGIN
  IF p_from IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_from = p_to THEN
    RAISE EXCEPTION 'Cannot transfer to yourself';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  PERFORM 1 FROM public.wallets WHERE user_id = p_from FOR UPDATE;
  PERFORM 1 FROM public.wallets WHERE user_id = p_to FOR UPDATE;

  SELECT mc INTO v_before_from
  FROM public.wallets
  WHERE user_id = p_from;

  IF v_before_from IS NULL THEN
    RAISE EXCEPTION 'Sender wallet not found';
  END IF;

  IF v_before_from < p_amount THEN
    RAISE EXCEPTION 'Insufficient MC balance';
  END IF;

  SELECT mc INTO v_before_to
  FROM public.wallets
  WHERE user_id = p_to;

  IF v_before_to IS NULL THEN
    INSERT INTO public.wallets (user_id, mc, gold, updated_at)
    VALUES (p_to, 0, 0, now());

    v_before_to := 0;
  END IF;

  v_after_from := v_before_from - p_amount;
  v_after_to := v_before_to + p_amount;

  UPDATE public.wallets
  SET mc = v_after_from,
      updated_at = now()
  WHERE user_id = p_from;

  UPDATE public.wallets
  SET mc = v_after_to,
      updated_at = now()
  WHERE user_id = p_to;

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
    p_from,
    p_from,
    p_to,
    p_amount,
    'MC',
    'transfer',
    'completed',
    '{}'::jsonb,
    v_before_from,
    v_after_from
  ) RETURNING id INTO v_tx_id;

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
    p_to,
    p_from,
    p_to,
    p_amount,
    'MC',
    'transfer',
    'completed',
    '{}'::jsonb,
    v_before_to,
    v_after_to
  );

  RETURN QUERY SELECT v_tx_id;
END;
$$;

-- Place room bet
CREATE OR REPLACE FUNCTION public.place_room_bet(
  p_user_id uuid,
  p_amount numeric
)
RETURNS TABLE(tx_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_tx_id uuid;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT mc INTO v_before
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF v_before < p_amount THEN
    RAISE EXCEPTION 'Insufficient MC balance';
  END IF;

  v_after := v_before - p_amount;

  UPDATE public.wallets
  SET mc = v_after,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.wallet_transactions(
    user_id,
    from_user_id,
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
    'bet',
    'completed',
    jsonb_build_object('reason','Create Room bet'),
    v_before,
    v_after
  ) RETURNING id INTO v_tx_id;

  RETURN QUERY SELECT v_tx_id;
END;
$$;