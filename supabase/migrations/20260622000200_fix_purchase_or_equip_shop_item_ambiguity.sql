-- The output-column variables of RETURNS TABLE are in PL/pgSQL scope, so all
-- table columns in this RPC must be explicitly qualified.
CREATE OR REPLACE FUNCTION public.purchase_or_equip_shop_item(p_item_id text)
RETURNS TABLE(status text, item_id text, category text, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.shop_items%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_already_owned boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT si.* INTO v_item
  FROM public.shop_items AS si
  WHERE si.id = p_item_id
    AND si.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop item is unavailable';
  END IF;

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (v_user_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT w.* INTO v_wallet
  FROM public.wallets AS w
  WHERE w.user_id = v_user_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_shop_items AS usi
    WHERE usi.user_id = v_user_id
      AND usi.item_id = v_item.id
  ) INTO v_already_owned;

  IF v_already_owned THEN
    INSERT INTO public.user_equipped_shop_items AS uesi (user_id, category, item_id, equipped_at)
    VALUES (v_user_id, v_item.category, v_item.id, now())
    ON CONFLICT (user_id, category) DO UPDATE
    SET item_id = EXCLUDED.item_id,
        equipped_at = EXCLUDED.equipped_at;

    RETURN QUERY SELECT 'equipped'::text, v_item.id, v_item.category, v_wallet.gold;
    RETURN;
  END IF;

  IF v_item.price_gold > 0 AND v_wallet.gold < v_item.price_gold THEN
    RETURN QUERY SELECT 'insufficient_gems'::text, v_item.id, v_item.category, v_wallet.gold;
    RETURN;
  END IF;

  IF v_item.price_gold > 0 THEN
    UPDATE public.wallets AS w
    SET gold = w.gold - v_item.price_gold,
        updated_at = now()
    WHERE w.user_id = v_user_id;

    INSERT INTO public.wallet_transactions (
      user_id, from_user_id, amount, currency, transaction_type, status,
      metadata, balance_before, balance_after
    ) VALUES (
      v_user_id, v_user_id, v_item.price_gold, 'Gold', 'shop_purchase', 'completed',
      jsonb_build_object('item_id', v_item.id, 'category', v_item.category),
      v_wallet.gold, v_wallet.gold - v_item.price_gold
    );
  END IF;

  INSERT INTO public.user_shop_items AS usi (user_id, item_id)
  VALUES (v_user_id, v_item.id);

  INSERT INTO public.user_equipped_shop_items AS uesi (user_id, category, item_id, equipped_at)
  VALUES (v_user_id, v_item.category, v_item.id, now())
  ON CONFLICT (user_id, category) DO UPDATE
  SET item_id = EXCLUDED.item_id,
      equipped_at = EXCLUDED.equipped_at;

  RETURN QUERY SELECT
    CASE WHEN v_item.price_gold = 0 THEN 'claimed' ELSE 'purchased' END,
    v_item.id,
    v_item.category,
    v_wallet.gold - v_item.price_gold;
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_or_equip_shop_item(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_or_equip_shop_item(text) TO authenticated;
