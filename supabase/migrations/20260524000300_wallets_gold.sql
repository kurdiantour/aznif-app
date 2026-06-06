-- Migration: Gold-specific wallet functions
-- Contains Gold-only functions: update_gold_balance, award_gold_reward, spend_gold_shop

CREATE OR REPLACE FUNCTION public.update_gold_balance(p_user_id uuid, p_delta numeric)
RETURNS TABLE(user_id uuid, mc numeric, gold numeric, updated_at timestamptz)
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet public.wallets%rowtype;
  v_new_gold numeric;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE wallets.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_delta < 0 THEN
      RAISE EXCEPTION 'Insufficient Gold balance';
    END IF;

    INSERT INTO public.wallets (user_id, mc, gold, updated_at)
    VALUES (p_user_id, 0, p_delta, now())
    RETURNING * INTO v_wallet;
  ELSE
    v_new_gold := v_wallet.gold + p_delta;

    IF v_new_gold < 0 THEN
      RAISE EXCEPTION 'Insufficient Gold balance';
    END IF;

    UPDATE public.wallets
    SET gold = v_new_gold, updated_at = now()
    WHERE wallets.user_id = p_user_id
    RETURNING * INTO v_wallet;
  END IF;

  RETURN QUERY SELECT v_wallet.user_id, v_wallet.mc, v_wallet.gold, v_wallet.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.award_gold_reward(
  p_user_id uuid,
  p_amount numeric,
  p_metadata jsonb DEFAULT '{}'::jsonb
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

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (p_user_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT gold INTO v_before
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  v_after := v_before + p_amount;

  UPDATE public.wallets
  SET gold = v_after, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.wallet_transactions(
    user_id, to_user_id, amount, currency, transaction_type, status, metadata, balance_before, balance_after
  ) VALUES (
    p_user_id, p_user_id, p_amount, 'Gold', 'reward', 'completed', p_metadata, v_before, v_after
  ) RETURNING id INTO v_tx_id;

  RETURN QUERY SELECT v_tx_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.spend_gold_shop(
  p_user_id uuid,
  p_amount numeric,
  p_metadata jsonb DEFAULT '{}'::jsonb
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

  SELECT gold INTO v_before
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF v_before < p_amount THEN
    RAISE EXCEPTION 'Insufficient Gold balance';
  END IF;

  v_after := v_before - p_amount;

  UPDATE public.wallets
  SET gold = v_after, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.wallet_transactions(
    user_id, from_user_id, amount, currency, transaction_type, status, metadata, balance_before, balance_after
  ) VALUES (
    p_user_id, p_user_id, p_amount, 'Gold', 'shop_purchase', 'completed', p_metadata, v_before, v_after
  ) RETURNING id INTO v_tx_id;

  RETURN QUERY SELECT v_tx_id;
END;
$$;