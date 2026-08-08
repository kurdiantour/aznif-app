-- Production shop catalog and durable cosmetic ownership.
CREATE TABLE IF NOT EXISTS public.shop_items (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('table_skin', 'tile_skin', 'avatar_frame')),
  price_gold integer NOT NULL CHECK (price_gold > 0),
  asset_key text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_shop_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES public.shop_items(id) ON DELETE RESTRICT,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_user_shop_items_user
ON public.user_shop_items(user_id, purchased_at DESC);
ALTER TABLE public.shop_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_shop_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shop_items_read_active"
ON public.shop_items FOR SELECT TO authenticated
USING (active = true);
CREATE POLICY "user_shop_items_read_own"
ON public.user_shop_items FOR SELECT TO authenticated
USING (user_id = auth.uid());
GRANT SELECT ON public.shop_items TO authenticated;
GRANT SELECT ON public.user_shop_items TO authenticated;
INSERT INTO public.shop_items(id, title, description, category, price_gold, asset_key, sort_order)
VALUES
  ('table-skin-midnight', 'Midnight Table', 'A deep blue cosmetic table finish.', 'table_skin', 45, 'table-midnight', 10),
  ('tile-skin-ivory', 'Ivory Tiles', 'A clean ivory domino tile style.', 'tile_skin', 60, 'tiles-ivory', 20),
  ('avatar-frame-violet', 'Violet Frame', 'A violet profile avatar frame.', 'avatar_frame', 30, 'frame-violet', 30)
ON CONFLICT (id) DO UPDATE
SET title = EXCLUDED.title,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    price_gold = EXCLUDED.price_gold,
    asset_key = EXCLUDED.asset_key,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();
CREATE OR REPLACE FUNCTION public.purchase_shop_item(p_item_id text)
RETURNS TABLE(
  ownership_id uuid,
  item_id text,
  balance_after numeric,
  purchased_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.shop_items%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_ownership public.user_shop_items%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_item FROM public.shop_items
  WHERE id = p_item_id AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shop item is unavailable'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_shop_items
    WHERE user_id = v_user_id AND item_id = v_item.id
  ) THEN
    RAISE EXCEPTION 'Item already owned';
  END IF;

  INSERT INTO public.wallets(user_id, mc, gold, updated_at)
  VALUES (v_user_id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.wallets
  WHERE user_id = v_user_id FOR UPDATE;
  IF v_wallet.gold < v_item.price_gold THEN RAISE EXCEPTION 'Insufficient Gold balance'; END IF;

  UPDATE public.wallets
  SET gold = gold - v_item.price_gold, updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO public.user_shop_items(user_id, item_id)
  VALUES (v_user_id, v_item.id)
  RETURNING * INTO v_ownership;

  INSERT INTO public.wallet_transactions(
    user_id, from_user_id, amount, currency, transaction_type, status,
    metadata, balance_before, balance_after
  ) VALUES (
    v_user_id, v_user_id, v_item.price_gold, 'Gold', 'shop_purchase', 'completed',
    jsonb_build_object('item_id', v_item.id, 'title', v_item.title, 'category', v_item.category),
    v_wallet.gold, v_wallet.gold - v_item.price_gold
  );

  RETURN QUERY SELECT v_ownership.id, v_item.id,
    v_wallet.gold - v_item.price_gold, v_ownership.purchased_at;
END;
$$;
REVOKE ALL ON FUNCTION public.purchase_shop_item(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_shop_item(text) TO authenticated;
-- Legacy arbitrary-price spending must not remain callable by clients.
REVOKE ALL ON FUNCTION public.spend_gold_shop(uuid, numeric, jsonb)
FROM PUBLIC, anon, authenticated;
