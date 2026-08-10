-- Server-authoritative seven-day Daily Gift in the Asia/Baghdad calendar.
CREATE TABLE IF NOT EXISTS public.daily_gift_progress (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  streak_day smallint NOT NULL DEFAULT 0 CHECK (streak_day BETWEEN 0 AND 7),
  last_claim_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_gift_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_date date NOT NULL,
  streak_day smallint NOT NULL CHECK (streak_day BETWEEN 1 AND 7),
  reward_type text NOT NULL CHECK (reward_type IN ('coin', 'gem', 'mc', 'special_chest')),
  reward_amount numeric NOT NULL CHECK (reward_amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, claim_date)
);

-- Day seven stays the existing special chest. Store it as a server-owned
-- entitlement until the product has a shared chest-opening inventory flow.
CREATE TABLE IF NOT EXISTS public.daily_gift_inventory (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  special_chest integer NOT NULL DEFAULT 0 CHECK (special_chest >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_gift_claims_user_created_idx
  ON public.daily_gift_claims(user_id, created_at DESC);

ALTER TABLE public.daily_gift_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_gift_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_gift_inventory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_gift_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.daily_gift_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.daily_gift_inventory FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_daily_gift_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Baghdad')::date;
  v_progress public.daily_gift_progress%ROWTYPE;
  v_completed integer := 0;
  v_current integer := 1;
  v_claimed_today boolean := false;
  v_statuses jsonb := '[]'::jsonb;
  v_index integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_progress FROM public.daily_gift_progress
  WHERE user_id = v_user_id;

  IF FOUND AND v_progress.last_claim_date = v_today THEN
    v_completed := v_progress.streak_day;
    v_current := NULL;
    v_claimed_today := true;
  ELSIF FOUND AND v_progress.last_claim_date = v_today - 1
    AND v_progress.streak_day BETWEEN 1 AND 6 THEN
    v_completed := v_progress.streak_day;
    v_current := v_progress.streak_day + 1;
  ELSE
    v_completed := 0;
    v_current := 1;
  END IF;

  FOR v_index IN 1..7 LOOP
    v_statuses := v_statuses || to_jsonb(
      CASE
        WHEN v_index <= v_completed THEN 'done'
        WHEN v_index = v_current THEN 'current'
        ELSE 'lock'
      END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'serverDate', v_today,
    'nextResetAt', ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Baghdad'),
    'currentDay', v_current,
    'canClaim', NOT v_claimed_today,
    'claimedToday', v_claimed_today,
    'statuses', v_statuses
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_daily_gift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Baghdad')::date;
  v_progress public.daily_gift_progress%ROWTYPE;
  v_day smallint;
  v_reward_type text;
  v_reward_amount numeric;
  v_claim_id uuid;
  v_before numeric;
  v_after numeric;
  v_status jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 47));
  INSERT INTO public.daily_gift_progress(user_id) VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_progress FROM public.daily_gift_progress
  WHERE user_id = v_user_id FOR UPDATE;

  IF v_progress.last_claim_date = v_today THEN
    SELECT id INTO v_claim_id FROM public.daily_gift_claims
    WHERE user_id = v_user_id AND claim_date = v_today;
    v_status := public.get_daily_gift_status();
    RETURN v_status || jsonb_build_object(
      'claimId', v_claim_id, 'alreadyClaimed', true,
      'awardedDay', v_progress.streak_day
    );
  END IF;

  IF v_progress.last_claim_date = v_today - 1
    AND v_progress.streak_day BETWEEN 1 AND 6 THEN
    v_day := v_progress.streak_day + 1;
  ELSE
    v_day := 1;
  END IF;

  SELECT reward_type, reward_amount INTO v_reward_type, v_reward_amount
  FROM (VALUES
    (1::smallint, 'coin'::text, 500::numeric),
    (2::smallint, 'coin'::text, 1000::numeric),
    (3::smallint, 'gem'::text, 30::numeric),
    (4::smallint, 'coin'::text, 1500::numeric),
    (5::smallint, 'gem'::text, 70::numeric),
    (6::smallint, 'mc'::text, 1::numeric),
    (7::smallint, 'special_chest'::text, 1::numeric)
  ) AS rewards(day_number, reward_type, reward_amount)
  WHERE day_number = v_day;

  INSERT INTO public.daily_gift_claims(
    user_id, claim_date, streak_day, reward_type, reward_amount
  ) VALUES (v_user_id, v_today, v_day, v_reward_type, v_reward_amount)
  RETURNING id INTO v_claim_id;

  IF v_reward_type = 'special_chest' THEN
    INSERT INTO public.daily_gift_inventory(user_id, special_chest, updated_at)
    VALUES (v_user_id, 1, now())
    ON CONFLICT (user_id) DO UPDATE
      SET special_chest = daily_gift_inventory.special_chest + 1,
          updated_at = now();
  ELSE
    INSERT INTO public.wallets(user_id, mc, coin, gem, updated_at)
    VALUES (v_user_id, 0, 0, 0, now())
    ON CONFLICT (user_id) DO NOTHING;

    IF v_reward_type = 'coin' THEN
      SELECT coin INTO v_before FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
      UPDATE public.wallets SET coin = coin + v_reward_amount, updated_at = now()
      WHERE user_id = v_user_id RETURNING coin INTO v_after;
    ELSIF v_reward_type = 'gem' THEN
      SELECT gem INTO v_before FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
      UPDATE public.wallets SET gem = gem + v_reward_amount, updated_at = now()
      WHERE user_id = v_user_id RETURNING gem INTO v_after;
    ELSE
      SELECT mc INTO v_before FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
      UPDATE public.wallets SET mc = mc + v_reward_amount, updated_at = now()
      WHERE user_id = v_user_id RETURNING mc INTO v_after;
    END IF;
  END IF;

  UPDATE public.daily_gift_progress
  SET streak_day = v_day, last_claim_date = v_today, updated_at = now()
  WHERE user_id = v_user_id;

  v_status := public.get_daily_gift_status();
  RETURN v_status || jsonb_build_object(
    'claimId', v_claim_id, 'alreadyClaimed', false, 'awardedDay', v_day,
    'rewardType', v_reward_type, 'rewardAmount', v_reward_amount,
    'balanceBefore', v_before, 'balanceAfter', v_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_gift_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_daily_gift() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_gift_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_gift() TO authenticated;
