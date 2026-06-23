-- Production catalog entries and durable default ownership for Domino Skins.
INSERT INTO public.shop_items (id, title, description, category, price_gold, asset_key, sort_order)
VALUES
  ('skin-ivory', 'Classic Ivory', 'Classic ivory domino skin.', 'domino-skins', 0, 'skin-ivory', 10),
  ('skin-purple', 'Royal Purple', 'Royal purple domino skin.', 'domino-skins', 430, 'skin-purple', 20),
  ('skin-black-gold', 'Black Gold VIP', 'Black and gold VIP domino skin.', 'domino-skins', 650, 'skin-black-gold', 30)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  price_gold = EXCLUDED.price_gold,
  asset_key = EXCLUDED.asset_key,
  sort_order = EXCLUDED.sort_order,
  active = true,
  updated_at = now();

-- Every existing account receives the free Classic Ivory skin. It becomes the
-- equipped skin only for users who have not already chosen a domino skin.
INSERT INTO public.user_shop_items (user_id, item_id)
SELECT u.id, 'skin-ivory'
FROM auth.users AS u
ON CONFLICT (user_id, item_id) DO NOTHING;

INSERT INTO public.user_equipped_shop_items (user_id, category, item_id, equipped_at)
SELECT u.id, 'domino-skins', 'skin-ivory', now()
FROM auth.users AS u
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_equipped_shop_items AS uesi
  WHERE uesi.user_id = u.id
    AND uesi.category = 'domino-skins'
)
ON CONFLICT (user_id, category) DO NOTHING;

-- Keep the default skin durable for accounts created after this migration.
CREATE OR REPLACE FUNCTION public.handle_new_user_wallets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (NEW.id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_shop_items (user_id, item_id)
  VALUES (NEW.id, 'skin-ivory')
  ON CONFLICT (user_id, item_id) DO NOTHING;

  INSERT INTO public.user_equipped_shop_items (user_id, category, item_id, equipped_at)
  VALUES (NEW.id, 'domino-skins', 'skin-ivory', now())
  ON CONFLICT (user_id, category) DO NOTHING;

  RETURN NEW;
END;
$$;
