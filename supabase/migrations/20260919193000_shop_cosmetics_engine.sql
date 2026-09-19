-- Unapplied migration: shared bundled cosmetics engine. Local validation only.
-- Legacy mapping: docs/shop-cosmetics-audit.md. Multiplayer RPCs are unchanged.
-- A draft price is unknown, never guessed.
BEGIN;
-- Canonical Shop currency is Gem. Convert the legacy Shop price column in-place
-- before this migration is ever deployed; do not create a second commercial price source.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shop_items' AND column_name = 'price_gold'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shop_items' AND column_name = 'price_gem'
  ) THEN
    ALTER TABLE public.shop_items RENAME COLUMN price_gold TO price_gem;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shop_items' AND column_name = 'price_gold'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shop_items' AND column_name = 'price_gem'
  ) THEN
    RAISE EXCEPTION 'shop_items has both price_gold and price_gem; audit remote schema before deploy';
  END IF;
END;
$$;
ALTER TABLE public.shop_items ALTER COLUMN price_gem DROP NOT NULL;
ALTER TABLE public.shop_items
  ADD COLUMN is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN available_from timestamptz,
  ADD COLUMN available_until timestamptz,
  ADD COLUMN free_from timestamptz,
  ADD COLUMN free_until timestamptz,
  ADD CONSTRAINT shop_items_priced_before_sale CHECK (price_gem IS NOT NULL OR NOT active),
  ADD CONSTRAINT shop_items_promotion_window CHECK (
    (free_from IS NULL AND free_until IS NULL) OR
    (free_from IS NOT NULL AND free_until IS NOT NULL
      AND isfinite(free_from) AND isfinite(free_until) AND free_from < free_until)
  ),
  ADD CONSTRAINT shop_items_sale_window CHECK (
    (available_from IS NULL OR isfinite(available_from)) AND
    (available_until IS NULL OR isfinite(available_until)) AND
    (available_from IS NULL OR available_until IS NULL OR available_from < available_until)
  ),
  ADD CONSTRAINT shop_items_valid_default CHECK (
    NOT is_default OR (enabled AND active AND price_gem IS NOT NULL AND price_gem = 0
      AND available_from IS NULL AND available_until IS NULL
      AND free_from IS NULL AND free_until IS NULL)
  ),
  ADD CONSTRAINT shop_items_id_category_key UNIQUE (id, category);
CREATE UNIQUE INDEX shop_items_one_default_per_category
  ON public.shop_items(category) WHERE is_default;
ALTER TABLE public.user_equipped_shop_items
  ADD CONSTRAINT user_equipped_shop_items_item_category_fkey
  FOREIGN KEY (item_id, category) REFERENCES public.shop_items(id, category);

-- IDs below are catalog/backfill data only, never branches in the engine.
INSERT INTO public.shop_items
  (id, title, description, category, price_gem, asset_key, sort_order)
VALUES
  ('table-emerald-ivory', 'Emerald Ivory', 'Emerald and ivory Okey set.', 'tables', 900, 'table-emerald-ivory', 40),
  ('domino-classic', 'Classic Domino', 'Classic Domino Set.', 'domino-skins', 0, 'domino-classic', 10),
  ('domino-emerald-ivory', 'Emerald Ivory', 'Emerald Ivory Domino Set.', 'domino-skins', 430, 'domino-emerald-ivory', 20)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.shop_items
  (id, title, description, category, price_gem, asset_key, sort_order, active)
VALUES ('table-zagros', 'Zagros', 'Zagros Okey Set.', 'tables', NULL, 'table-zagros', 50, false)
ON CONFLICT (id) DO NOTHING;
UPDATE public.shop_items SET is_default = true, active = true, enabled = true,
  price_gem = 0, updated_at = now()
WHERE id IN ('table-classic', 'domino-classic', 'cover-dusk');

-- No paid legacy item has a proven equivalent: retain ownership, IDs and keys.
UPDATE public.shop_items SET active = false, updated_at = now()
WHERE id IN ('skin-ivory', 'skin-obsidian', 'skin-aurora', 'skin-purple', 'skin-black-gold');
UPDATE public.user_equipped_shop_items AS e
SET item_id = d.id, equipped_at = now()
FROM public.shop_items AS d
WHERE e.item_id = 'skin-ivory' AND e.category = d.category AND d.is_default;

CREATE SCHEMA IF NOT EXISTS shop_private;
REVOKE ALL ON SCHEMA shop_private FROM PUBLIC, anon, authenticated;
-- A designated default cannot disappear. CHECK protects its perpetual free use.
CREATE FUNCTION shop_private.protect_default()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.is_default THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A category default cannot be deleted'; END IF;
    IF NOT NEW.is_default OR NEW.id <> OLD.id OR NEW.category <> OLD.category THEN
      RAISE EXCEPTION 'A category default identity cannot be removed or moved';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_shop_category_default
BEFORE UPDATE OR DELETE ON public.shop_items
FOR EACH ROW EXECUTE FUNCTION shop_private.protect_default();

-- One shared predicate. active/windows govern acquisition; enabled governs use.
CREATE FUNCTION shop_private.access_kind(
  p_item public.shop_items, p_owned boolean, p_now timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT p_item.enabled THEN NULL
    WHEN p_item.is_default THEN 'default'
    WHEN p_owned THEN 'owned'
    WHEN NOT p_item.active
      OR (p_item.available_from IS NOT NULL AND p_now < p_item.available_from)
      OR (p_item.available_until IS NOT NULL AND p_now >= p_item.available_until) THEN NULL
    WHEN p_item.free_from IS NOT NULL AND p_item.free_until IS NOT NULL
      AND p_item.free_from < p_item.free_until
      AND p_now >= p_item.free_from AND p_now < p_item.free_until THEN 'temporary'
    WHEN p_item.price_gem = 0 THEN 'free'
    ELSE NULL
  END;
$$;

-- Shop defaults have their own signup hook. Do not replace or own wallet creation.
CREATE FUNCTION shop_private.provision_defaults_for_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.user_shop_items(user_id, item_id)
  SELECT NEW.id, s.id FROM public.shop_items AS s WHERE s.is_default
  ON CONFLICT (user_id, item_id) DO NOTHING;
  INSERT INTO public.user_equipped_shop_items(user_id, category, item_id)
  SELECT NEW.id, s.category, s.id FROM public.shop_items AS s WHERE s.is_default
  ON CONFLICT ON CONSTRAINT user_equipped_shop_items_pkey DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trigger_provision_shop_defaults
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION shop_private.provision_defaults_for_new_user();
INSERT INTO public.user_shop_items(user_id, item_id)
SELECT u.id, s.id FROM auth.users AS u CROSS JOIN public.shop_items AS s WHERE s.is_default
ON CONFLICT (user_id, item_id) DO NOTHING;
INSERT INTO public.user_equipped_shop_items(user_id, category, item_id)
SELECT u.id, s.category, s.id FROM auth.users AS u CROSS JOIN public.shop_items AS s WHERE s.is_default
ON CONFLICT ON CONSTRAINT user_equipped_shop_items_pkey DO NOTHING;

-- Own state only; no definer view exposing other users' equipment.
CREATE FUNCTION public.get_my_shop_state()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := statement_timestamp();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  WITH catalog AS (
    SELECT s.*, (o.item_id IS NOT NULL) AS owned,
      shop_private.access_kind(s, o.item_id IS NOT NULL, v_now) AS access_kind,
      (s.enabled AND s.active
        AND (s.available_from IS NULL OR s.available_from <= v_now)
        AND (s.available_until IS NULL OR v_now < s.available_until)) AS sale_available
    FROM public.shop_items AS s
    LEFT JOIN public.user_shop_items AS o ON o.item_id = s.id AND o.user_id = v_user_id
    WHERE EXISTS (SELECT 1 FROM public.shop_items AS d WHERE d.category = s.category AND d.is_default)
  ), resolved AS (
    SELECT d.category, CASE WHEN chosen.access_kind IS NOT NULL THEN chosen.id ELSE d.id END AS item_id
    FROM catalog AS d
    LEFT JOIN public.user_equipped_shop_items AS e ON e.user_id = v_user_id AND e.category = d.category
    LEFT JOIN catalog AS chosen ON chosen.id = e.item_id AND chosen.category = d.category
    WHERE d.is_default
  )
  SELECT jsonb_build_object(
    'server_now', v_now,
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.sort_order, c.id) FROM catalog AS c), '[]'::jsonb),
    'equipped', COALESCE((SELECT jsonb_object_agg(r.category, r.item_id) FROM resolved AS r), '{}'::jsonb),
    'next_change_at', (SELECT min(t.boundary) FROM catalog AS c
      CROSS JOIN LATERAL (VALUES (c.free_from), (c.free_until), (c.available_from), (c.available_until)) AS t(boundary)
      WHERE t.boundary > v_now)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_shop_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_shop_state() TO authenticated;

-- Avoid ambiguous PostgREST overloads. NULL consent means equip/free use only.
-- Expected price never determines the charge: arithmetic uses the locked DB row.
DROP FUNCTION public.purchase_or_equip_shop_item(text);
CREATE FUNCTION public.purchase_or_equip_shop_item(p_item_id text, p_expected_price integer DEFAULT NULL)
RETURNS TABLE(status text, item_id text, category text, balance_after numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.shop_items%ROWTYPE;
  v_balance numeric;
  v_owned boolean;
  v_access text;
  v_now timestamptz;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT s.* INTO v_item FROM public.shop_items AS s WHERE s.id = p_item_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shop item is unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shop_items AS d WHERE d.category = v_item.category AND d.is_default) THEN
    RAISE EXCEPTION 'Unsupported shop category';
  END IF;
  INSERT INTO public.wallets(user_id, mc, coin, gem, updated_at)
  VALUES (v_user_id, 0, 0, 0, now()) ON CONFLICT (user_id) DO NOTHING;
  SELECT w.gem INTO v_balance FROM public.wallets AS w WHERE w.user_id = v_user_id FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM public.user_shop_items AS o WHERE o.user_id = v_user_id AND o.item_id = v_item.id) INTO v_owned;
  v_now := clock_timestamp();
  v_access := shop_private.access_kind(v_item, v_owned, v_now);
  IF v_access IS NULL THEN
    IF NOT v_item.enabled OR NOT v_item.active
      OR (v_item.available_from IS NOT NULL AND v_now < v_item.available_from)
      OR (v_item.available_until IS NOT NULL AND v_now >= v_item.available_until) THEN
      RETURN QUERY SELECT 'unavailable'::text, v_item.id, v_item.category, v_balance;
      RETURN;
    END IF;
    IF p_expected_price IS NULL OR p_expected_price <> v_item.price_gem THEN
      RETURN QUERY SELECT 'price_changed'::text, v_item.id, v_item.category, v_balance;
      RETURN;
    END IF;
    IF v_balance < v_item.price_gem THEN
      RETURN QUERY SELECT 'insufficient_gems'::text, v_item.id, v_item.category, v_balance;
      RETURN;
    END IF;
    UPDATE public.wallets AS w SET gem = w.gem - v_item.price_gem, updated_at = v_now WHERE w.user_id = v_user_id;
    INSERT INTO public.wallet_transactions(
      user_id, from_user_id, amount, currency, transaction_type, status, metadata, balance_before, balance_after
    ) VALUES (
      v_user_id, v_user_id, v_item.price_gem, 'Gem', 'shop_purchase', 'completed',
      jsonb_build_object('item_id', v_item.id, 'category', v_item.category), v_balance, v_balance - v_item.price_gem
    );
    v_balance := v_balance - v_item.price_gem;
  END IF;
  -- Even a zero-base-price item on promotion is not a permanent claim.
  IF v_access IS NULL OR v_access = 'free' THEN
    INSERT INTO public.user_shop_items(user_id, item_id) VALUES (v_user_id, v_item.id);
  END IF;
  INSERT INTO public.user_equipped_shop_items(user_id, category, item_id, equipped_at)
  VALUES (v_user_id, v_item.category, v_item.id, v_now)
  ON CONFLICT ON CONSTRAINT user_equipped_shop_items_pkey DO UPDATE
    SET item_id = EXCLUDED.item_id, equipped_at = EXCLUDED.equipped_at;
  RETURN QUERY SELECT CASE WHEN v_access IS NULL THEN 'purchased' WHEN v_access = 'free' THEN 'claimed' ELSE 'equipped' END,
    v_item.id, v_item.category, v_balance;
END;
$$;
REVOKE ALL ON FUNCTION public.purchase_or_equip_shop_item(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_or_equip_shop_item(text, integer) TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA shop_private FROM PUBLIC, anon, authenticated;
COMMIT;

