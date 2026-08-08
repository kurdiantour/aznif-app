-- Keep PL/pgSQL output parameters out of all SQL expressions by using scalar
-- variables and explicitly aliased table columns throughout the RPC.
CREATE OR REPLACE FUNCTION public.purchase_or_equip_shop_item(p_item_id text)
RETURNS TABLE(status text, item_id text, category text, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item_id text;
  v_category text;
  v_price_gold integer;
  v_wallet_gold numeric;
  v_new_gold numeric;
  v_is_owned boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT si.id, si.category, si.price_gold
  INTO v_item_id, v_category, v_price_gold
  FROM public.shop_items AS si
  WHERE si.id = p_item_id
    AND si.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop item is unavailable';
  END IF;

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (v_user_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT w.gold
  INTO v_wallet_gold
  FROM public.wallets AS w
  WHERE w.user_id = v_user_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_shop_items AS usi
    WHERE usi.user_id = v_user_id
      AND usi.item_id = v_item_id
  ) INTO v_is_owned;

  IF v_is_owned THEN
    INSERT INTO public.user_equipped_shop_items AS uesi (user_id, category, item_id, equipped_at)
    VALUES (v_user_id, v_category, v_item_id, now())
    ON CONFLICT ON CONSTRAINT user_equipped_shop_items_pkey DO UPDATE
    SET item_id = EXCLUDED.item_id,
        equipped_at = EXCLUDED.equipped_at;

    RETURN QUERY SELECT 'equipped'::text, v_item_id, v_category, v_wallet_gold;
    RETURN;
  END IF;

  IF v_price_gold > 0 AND v_wallet_gold < v_price_gold THEN
    RETURN QUERY SELECT 'insufficient_gems'::text, v_item_id, v_category, v_wallet_gold;
    RETURN;
  END IF;

  IF v_price_gold > 0 THEN
    UPDATE public.wallets AS w
    SET gold = w.gold - v_price_gold,
        updated_at = now()
    WHERE w.user_id = v_user_id
    RETURNING w.gold INTO v_new_gold;

    INSERT INTO public.wallet_transactions (
      user_id, from_user_id, amount, currency, transaction_type, status,
      metadata, balance_before, balance_after
    ) VALUES (
      v_user_id, v_user_id, v_price_gold, 'Gold', 'shop_purchase', 'completed',
      jsonb_build_object('item_id', v_item_id, 'category', v_category),
      v_wallet_gold, v_new_gold
    );
  ELSE
    v_new_gold := v_wallet_gold;
  END IF;

  INSERT INTO public.user_shop_items AS usi (user_id, item_id)
  VALUES (v_user_id, v_item_id);

  INSERT INTO public.user_equipped_shop_items AS uesi (user_id, category, item_id, equipped_at)
  VALUES (v_user_id, v_category, v_item_id, now())
  ON CONFLICT ON CONSTRAINT user_equipped_shop_items_pkey DO UPDATE
  SET item_id = EXCLUDED.item_id,
      equipped_at = EXCLUDED.equipped_at;

  RETURN QUERY SELECT
    CASE WHEN v_price_gold = 0 THEN 'claimed' ELSE 'purchased' END,
    v_item_id,
    v_category,
    v_new_gold;
END;
$$;
REVOKE ALL ON FUNCTION public.purchase_or_equip_shop_item(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_or_equip_shop_item(text) TO authenticated;
