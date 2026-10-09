-- Transfer existing wallet funds by an Owner Admin or Finance Admin.
-- A function call runs in one database transaction; any error rolls back both
-- balance updates and both audit rows.
CREATE FUNCTION public.distribute_wallet_currency(
  p_receiver_id uuid,
  p_currency text,
  p_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sender_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_column text;
  v_sender_before numeric;
  v_receiver_before numeric;
  v_transfer_id uuid := gen_random_uuid();
  v_metadata jsonb;
BEGIN
  SELECT CASE
    WHEN p.is_admin THEN 'owner'
    WHEN p.is_finance_admin THEN 'finance'
  END
  INTO v_actor_role
  FROM public.profiles AS p
  WHERE p.id = v_sender_id;

  IF v_sender_id IS NULL OR v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Wallet distribution access required'
      USING ERRCODE = '42501';
  END IF;

  IF p_receiver_id IS NULL OR p_receiver_id = v_sender_id THEN
    RAISE EXCEPTION 'A different receiver is required';
  END IF;

  IF p_currency IS NULL OR p_currency NOT IN ('MC', 'Coin', 'Gem') THEN
    RAISE EXCEPTION 'Unsupported currency';
  END IF;

  IF p_amount IS NULL
     OR p_amount::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_amount <= 0
     OR p_amount <> trunc(p_amount) THEN
    RAISE EXCEPTION 'Amount must be a positive whole number';
  END IF;

  -- Receiver can be any existing profile, including a Player, Finance Admin, or Owner Admin.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_receiver_id
  ) THEN
    RAISE EXCEPTION 'Receiver not found';
  END IF;

  v_column := CASE p_currency
    WHEN 'MC' THEN 'mc'
    WHEN 'Coin' THEN 'coin'
    ELSE 'gem'
  END;

  -- Lock both existing wallets in a stable order before reading balances.
  PERFORM 1
  FROM public.wallets AS w
  WHERE w.user_id IN (v_sender_id, p_receiver_id)
  ORDER BY w.user_id
  FOR UPDATE;

  EXECUTE format(
    'SELECT %I FROM public.wallets WHERE user_id = $1',
    v_column
  )
  INTO v_sender_before
  USING v_sender_id;

  EXECUTE format(
    'SELECT %I FROM public.wallets WHERE user_id = $1',
    v_column
  )
  INTO v_receiver_before
  USING p_receiver_id;

  IF v_sender_before IS NULL OR v_receiver_before IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF v_sender_before < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  EXECUTE format(
    'UPDATE public.wallets
     SET %I = %I - $1,
         updated_at = now()
     WHERE user_id = $2',
    v_column,
    v_column
  )
  USING p_amount, v_sender_id;

  EXECUTE format(
    'UPDATE public.wallets
     SET %I = %I + $1,
         updated_at = now()
     WHERE user_id = $2',
    v_column,
    v_column
  )
  USING p_amount, p_receiver_id;

  v_metadata := jsonb_build_object(
    'transfer_id', v_transfer_id,
    'actor_role', v_actor_role,
    'currency', p_currency,
    'amount', p_amount,
    'from_user_id', v_sender_id,
    'to_user_id', p_receiver_id
  );

  INSERT INTO public.wallet_transactions (
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
  )
  VALUES
    (
      v_sender_id,
      v_sender_id,
      p_receiver_id,
      p_amount,
      p_currency,
      'distribution_debit',
      'completed',
      v_metadata,
      v_sender_before,
      v_sender_before - p_amount
    ),
    (
      p_receiver_id,
      v_sender_id,
      p_receiver_id,
      p_amount,
      p_currency,
      'distribution_credit',
      'completed',
      v_metadata,
      v_receiver_before,
      v_receiver_before + p_amount
    );

  RETURN v_transfer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.distribute_wallet_currency(uuid, text, numeric)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.distribute_wallet_currency(uuid, text, numeric)
  TO authenticated;

NOTIFY pgrst, 'reload schema';