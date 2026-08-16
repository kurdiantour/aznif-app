-- ============================================================
-- RPC to open Day 7 Special Chest with level-scaled rewards
-- ============================================================

CREATE OR REPLACE FUNCTION public.open_special_chest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_inv public.daily_gift_inventory%ROWTYPE;
  v_level integer;
  v_coins numeric;
  v_gems numeric;
  v_mc numeric;
  v_coin_before numeric;
  v_coin_after numeric;
  v_gem_before numeric;
  v_gem_after numeric;
  v_mc_before numeric;
  v_mc_after numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  -- 1. Lock execution for the user to prevent concurrent double-opening
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 48));

  -- 2. Lock and retrieve the user's chest inventory row
  SELECT * INTO v_inv
  FROM public.daily_gift_inventory
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_inv.special_chest < 1 THEN
    RAISE EXCEPTION 'no_special_chest_available' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Decrement chest count
  UPDATE public.daily_gift_inventory
  SET special_chest = special_chest - 1,
      updated_at = now()
  WHERE user_id = v_user_id;

  -- 4. Get player level
  SELECT COALESCE(level, 1) INTO v_level
  FROM public.profiles
  WHERE id = v_user_id;

  -- 5. Calculate scaled rewards
  -- Level 1-3: 2000 Coins + 50 Gems
  -- Level 4-6: 5000 Coins + 120 Gems
  -- Level 7+: 10000 Coins + 250 Gems + 1 Aznif (MC)
  IF v_level <= 3 THEN
    v_coins := 2000;
    v_gems := 50;
    v_mc := 0;
  ELSIF v_level <= 6 THEN
    v_coins := 5000;
    v_gems := 120;
    v_mc := 0;
  ELSE
    v_coins := 10000;
    v_gems := 250;
    v_mc := 1;
  END IF;

  -- 6. Update player wallets
  INSERT INTO public.wallets(user_id, mc, coin, gem, updated_at)
  VALUES (v_user_id, 0, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT coin, gem, mc INTO v_coin_before, v_gem_before, v_mc_before
  FROM public.wallets
  WHERE user_id = v_user_id
  FOR UPDATE;

  UPDATE public.wallets
  SET coin = coin + v_coins,
      gem = gem + v_gems,
      mc = mc + v_mc,
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING coin, gem, mc INTO v_coin_after, v_gem_after, v_mc_after;

  -- 7. Return awarded values and new wallet balances
  RETURN jsonb_build_object(
    'success', true,
    'awardedCoins', v_coins,
    'awardedGems', v_gems,
    'awardedMc', v_mc,
    'playerLevel', v_level,
    'balances', jsonb_build_object(
      'coinBefore', v_coin_before,
      'coinAfter', v_coin_after,
      'gemBefore', v_gem_before,
      'gemAfter', v_gem_after,
      'mcBefore', v_mc_before,
      'mcAfter', v_mc_after
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.open_special_chest() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_special_chest() TO authenticated;

NOTIFY pgrst, 'reload schema';
