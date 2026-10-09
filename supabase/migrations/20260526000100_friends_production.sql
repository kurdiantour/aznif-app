-- Friends and MC friend transfers

DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);
CREATE TABLE IF NOT EXISTS public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_pair
ON public.friendships (
  LEAST(requester_id, addressee_id),
  GREATEST(requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_requester
ON public.friendships (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee
ON public.friendships (addressee_id, status);
CREATE OR REPLACE FUNCTION public.set_friendships_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_set_friendships_updated_at ON public.friendships;
CREATE TRIGGER trigger_set_friendships_updated_at
BEFORE UPDATE ON public.friendships
FOR EACH ROW
EXECUTE FUNCTION public.set_friendships_updated_at();
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "friendships_select_own" ON public.friendships;
CREATE POLICY "friendships_select_own"
ON public.friendships
FOR SELECT
TO authenticated
USING (requester_id = auth.uid() OR addressee_id = auth.uid());
GRANT SELECT ON public.friendships TO authenticated;
CREATE OR REPLACE FUNCTION public.search_friend_candidates(p_query text, p_limit integer DEFAULT 10)
RETURNS TABLE(
  id uuid,
  username text,
  player_id text,
  avatar_id text,
  friendship_status text,
  friendship_direction text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.username,
    p.player_id,
    p.avatar_id,
    f.status AS friendship_status,
    CASE
      WHEN f.requester_id = auth.uid() THEN 'outgoing'
      WHEN f.addressee_id = auth.uid() THEN 'incoming'
      ELSE NULL
    END AS friendship_direction
  FROM public.profiles p
  LEFT JOIN public.friendships f
    ON (
      (f.requester_id = auth.uid() AND f.addressee_id = p.id)
      OR (f.addressee_id = auth.uid() AND f.requester_id = p.id)
    )
  WHERE auth.uid() IS NOT NULL
    AND p.id <> auth.uid()
    AND length(trim(coalesce(p_query, ''))) >= 2
    AND (
      p.username ILIKE '%' || trim(p_query) || '%'
      OR p.player_id ILIKE '%' || trim(p_query) || '%'
    )
  ORDER BY p.username ASC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 10), 1), 25);
$$;
CREATE OR REPLACE FUNCTION public.send_friend_request(p_addressee uuid)
RETURNS TABLE(friendship_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.friendships%rowtype;
  v_friendship public.friendships%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_addressee = auth.uid() THEN
    RAISE EXCEPTION 'Cannot add yourself';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_addressee) THEN
    RAISE EXCEPTION 'Player not found';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.friendships
  WHERE LEAST(requester_id, addressee_id) = LEAST(auth.uid(), p_addressee)
    AND GREATEST(requester_id, addressee_id) = GREATEST(auth.uid(), p_addressee)
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'rejected' THEN
      UPDATE public.friendships
      SET requester_id = auth.uid(),
          addressee_id = p_addressee,
          status = 'pending',
          responded_at = NULL
      WHERE id = v_existing.id
      RETURNING * INTO v_friendship;
    ELSE
      v_friendship := v_existing;
    END IF;
  ELSE
    INSERT INTO public.friendships (requester_id, addressee_id, status)
    VALUES (auth.uid(), p_addressee, 'pending')
    RETURNING * INTO v_friendship;
  END IF;

  RETURN QUERY SELECT v_friendship.id, v_friendship.status;
END;
$$;
DROP FUNCTION IF EXISTS public.respond_friend_request(uuid, boolean);
CREATE OR REPLACE FUNCTION public.respond_friend_request(p_friendship_id uuid, p_accept boolean)
RETURNS TABLE(friendship_id uuid, friendship_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_friendship public.friendships%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
  INTO v_friendship
  FROM public.friendships f
  WHERE f.id = p_friendship_id
    AND f.addressee_id = auth.uid()
    AND f.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend request not found';
  END IF;

  UPDATE public.friendships
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,
      responded_at = now()
  WHERE friendships.id = p_friendship_id
  RETURNING * INTO v_friendship;

  RETURN QUERY SELECT v_friendship.id, v_friendship.status;
END;
$$;
CREATE OR REPLACE FUNCTION public.are_friends(p_first uuid, p_second uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.friendships
    WHERE status = 'accepted'
      AND (
        (requester_id = p_first AND addressee_id = p_second)
        OR (requester_id = p_second AND addressee_id = p_first)
      )
  );
$$;
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

  IF NOT public.are_friends(p_from, p_to) THEN
    RAISE EXCEPTION 'You can only send MC to confirmed friends';
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
GRANT EXECUTE ON FUNCTION public.search_friend_candidates(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_friend_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.are_friends(uuid, uuid)
TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.are_friends(uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_mc(uuid, uuid, numeric) TO authenticated;
