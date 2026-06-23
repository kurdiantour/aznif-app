-- Durable ownership, equipped cosmetics, and atomic gem purchases.
ALTER TABLE public.shop_items
  DROP CONSTRAINT IF EXISTS shop_items_price_gold_check;

ALTER TABLE public.shop_items
  ADD CONSTRAINT shop_items_price_gold_check CHECK (price_gold >= 0);

ALTER TABLE public.shop_items
  DROP CONSTRAINT IF EXISTS shop_items_category_check;

ALTER TABLE public.shop_items
  ADD CONSTRAINT shop_items_category_check
  CHECK (category IN ('tables', 'domino-skins', 'profile-covers', 'table_skin', 'tile_skin', 'avatar_frame'));

CREATE TABLE IF NOT EXISTS public.user_equipped_shop_items (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('tables', 'domino-skins', 'profile-covers')),
  item_id text NOT NULL REFERENCES public.shop_items(id) ON DELETE RESTRICT,
  equipped_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

ALTER TABLE public.user_equipped_shop_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_equipped_shop_items_read_own" ON public.user_equipped_shop_items;
CREATE POLICY "user_equipped_shop_items_read_own"
ON public.user_equipped_shop_items FOR SELECT TO authenticated
USING (user_id = auth.uid());

GRANT SELECT ON public.user_equipped_shop_items TO authenticated;

INSERT INTO public.shop_items (id, title, description, category, price_gold, asset_key, sort_order)
VALUES
  ('table-classic', 'Classic table', 'Classic game table.', 'tables', 0, 'table-classic', 10),
  ('table-midnight', 'Midnight table', 'Purple game table.', 'tables', 350, 'table-midnight', 20),
  ('table-royal', 'Royal table', 'Black and gold game table.', 'tables', 520, 'table-royal', 30),
  ('skin-ivory', 'Ivory skin', 'Ivory domino skin.', 'domino-skins', 0, 'skin-ivory', 10),
  ('skin-obsidian', 'Obsidian skin', 'Obsidian domino skin.', 'domino-skins', 430, 'skin-obsidian', 20),
  ('skin-aurora', 'Aurora skin', 'Aurora domino skin.', 'domino-skins', 650, 'skin-aurora', 30),
  ('cover-dusk', 'Dusk cover', 'Dusk profile cover.', 'profile-covers', 0, 'cover-dusk', 10),
  ('cover-gold', 'Gold cover', 'Gold profile cover.', 'profile-covers', 300, 'cover-gold', 20),
  ('cover-oasis', 'Oasis cover', 'Oasis profile cover.', 'profile-covers', 480, 'cover-oasis', 30)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  price_gold = EXCLUDED.price_gold,
  asset_key = EXCLUDED.asset_key,
  sort_order = EXCLUDED.sort_order,
  active = true,
  updated_at = now();

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

  SELECT * INTO v_item
  FROM public.shop_items
  WHERE id = p_item_id AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop item is unavailable';
  END IF;

  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (v_user_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = v_user_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.user_shop_items
    WHERE user_id = v_user_id AND item_id = v_item.id
  ) INTO v_already_owned;

  IF v_already_owned THEN
    INSERT INTO public.user_equipped_shop_items (user_id, category, item_id, equipped_at)
    VALUES (v_user_id, v_item.category, v_item.id, now())
    ON CONFLICT (user_id, category) DO UPDATE
    SET item_id = EXCLUDED.item_id, equipped_at = EXCLUDED.equipped_at;

    RETURN QUERY SELECT 'equipped'::text, v_item.id, v_item.category, v_wallet.gold;
    RETURN;
  END IF;

  IF v_item.price_gold > 0 AND v_wallet.gold < v_item.price_gold THEN
    RETURN QUERY SELECT 'insufficient_gems'::text, v_item.id, v_item.category, v_wallet.gold;
    RETURN;
  END IF;

  IF v_item.price_gold > 0 THEN
    UPDATE public.wallets
    SET gold = gold - v_item.price_gold, updated_at = now()
    WHERE user_id = v_user_id;

    INSERT INTO public.wallet_transactions (
      user_id, from_user_id, amount, currency, transaction_type, status,
      metadata, balance_before, balance_after
    ) VALUES (
      v_user_id, v_user_id, v_item.price_gold, 'Gold', 'shop_purchase', 'completed',
      jsonb_build_object('item_id', v_item.id, 'category', v_item.category),
      v_wallet.gold, v_wallet.gold - v_item.price_gold
    );
  END IF;

  INSERT INTO public.user_shop_items (user_id, item_id)
  VALUES (v_user_id, v_item.id);

  INSERT INTO public.user_equipped_shop_items (user_id, category, item_id, equipped_at)
  VALUES (v_user_id, v_item.category, v_item.id, now())
  ON CONFLICT (user_id, category) DO UPDATE
  SET item_id = EXCLUDED.item_id, equipped_at = EXCLUDED.equipped_at;

  RETURN QUERY SELECT
    CASE WHEN v_item.price_gold = 0 THEN 'claimed' ELSE 'purchased' END,
    v_item.id,
    v_item.category,
    v_wallet.gold - v_item.price_gold;
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_or_equip_shop_item(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_or_equip_shop_item(text) TO authenticated;

-- Clients must use the purchase-and-equip RPC above; the older purchase-only
-- entry point does not persist the equipped cosmetic.
REVOKE ALL ON FUNCTION public.purchase_shop_item(text) FROM PUBLIC, anon, authenticated;
