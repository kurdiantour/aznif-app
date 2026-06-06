-- Atomic MC transfers between accepted friends.

CREATE TABLE IF NOT EXISTS public.mc_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_transfers_sender
ON public.mc_transfers (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mc_transfers_receiver
ON public.mc_transfers (receiver_id, created_at DESC);

ALTER TABLE public.mc_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mc_transfers_select_own" ON public.mc_transfers;

CREATE POLICY "mc_transfers_select_own"
ON public.mc_transfers
FOR SELECT
TO authenticated
USING (sender_id = auth.uid() OR receiver_id = auth.uid());

GRANT SELECT ON public.mc_transfers TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_mc_to_friend(
  receiver_profile_id uuid,
  transfer_amount integer
)
RETURNS TABLE(success boolean, transfer_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_id uuid := auth.uid();
  v_sender_before numeric;
  v_receiver_before numeric;
  v_sender_after numeric;
  v_receiver_after numeric;
  v_transfer_id uuid;
BEGIN
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF transfer_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF receiver_profile_id = v_sender_id THEN
    RAISE EXCEPTION 'Cannot transfer to yourself';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = receiver_profile_id) THEN
    RAISE EXCEPTION 'Receiver profile not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.friendships f
    WHERE f.status = 'accepted'
      AND (
        (f.requester_id = v_sender_id AND f.addressee_id = receiver_profile_id)
        OR (f.requester_id = receiver_profile_id AND f.addressee_id = v_sender_id)
      )
  ) THEN
    RAISE EXCEPTION 'You can only send MC to confirmed friends';
  END IF;

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (v_sender_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (receiver_profile_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock both wallet rows in deterministic order to avoid transfer deadlocks.
  PERFORM 1
  FROM public.wallets
  WHERE user_id IN (v_sender_id, receiver_profile_id)
  ORDER BY user_id
  FOR UPDATE;

  SELECT mc
  INTO v_sender_before
  FROM public.wallets
  WHERE user_id = v_sender_id;

  IF v_sender_before < transfer_amount THEN
    RAISE EXCEPTION 'Insufficient MC balance';
  END IF;

  SELECT mc
  INTO v_receiver_before
  FROM public.wallets
  WHERE user_id = receiver_profile_id;

  v_sender_after := v_sender_before - transfer_amount;
  v_receiver_after := v_receiver_before + transfer_amount;

  UPDATE public.wallets
  SET mc = v_sender_after,
      updated_at = now()
  WHERE user_id = v_sender_id;

  UPDATE public.wallets
  SET mc = v_receiver_after,
      updated_at = now()
  WHERE user_id = receiver_profile_id;

  INSERT INTO public.mc_transfers (sender_id, receiver_id, amount, status)
  VALUES (v_sender_id, receiver_profile_id, transfer_amount, 'completed')
  RETURNING id INTO v_transfer_id;

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
    v_sender_id,
    v_sender_id,
    receiver_profile_id,
    transfer_amount,
    'MC',
    'transfer',
    'completed',
    jsonb_build_object('transfer_id', v_transfer_id),
    v_sender_before,
    v_sender_after
  );

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
    receiver_profile_id,
    v_sender_id,
    receiver_profile_id,
    transfer_amount,
    'MC',
    'transfer',
    'completed',
    jsonb_build_object('transfer_id', v_transfer_id),
    v_receiver_before,
    v_receiver_after
  );

  RETURN QUERY SELECT true, v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_mc_to_friend(uuid, integer) TO authenticated;
