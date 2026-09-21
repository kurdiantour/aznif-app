-- Canonical Shop catalog baseline.
-- Commercial metadata (including price_gem) lives only in the database.
BEGIN;

CREATE TABLE public.shop_items (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL CHECK (category IN ('tables', 'domino-skins')),
  price_gem integer CHECK (price_gem IS NULL OR price_gem >= 0),
  asset_key text NOT NULL CHECK (btrim(asset_key) <> ''),
  active boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  available_from timestamptz,
  available_until timestamptz,
  free_from timestamptz,
  free_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_items_priced_before_sale CHECK (price_gem IS NOT NULL OR NOT active),
  CONSTRAINT shop_items_promotion_window CHECK (
    (free_from IS NULL AND free_until IS NULL) OR
    (free_from IS NOT NULL AND free_until IS NOT NULL
      AND isfinite(free_from) AND isfinite(free_until) AND free_from < free_until)
  ),
  CONSTRAINT shop_items_sale_window CHECK (
    (available_from IS NULL OR isfinite(available_from)) AND
    (available_until IS NULL OR isfinite(available_until)) AND
    (available_from IS NULL OR available_until IS NULL OR available_from < available_until)
  ),
  CONSTRAINT shop_items_valid_default CHECK (
    NOT is_default OR (
      enabled AND active AND price_gem = 0
      AND available_from IS NULL AND available_until IS NULL
      AND free_from IS NULL AND free_until IS NULL
    )
  ),
  CONSTRAINT shop_items_id_category_key UNIQUE (id, category)
);

CREATE UNIQUE INDEX shop_items_one_default_per_category
  ON public.shop_items(category) WHERE is_default;
CREATE INDEX shop_items_category_sort_idx
  ON public.shop_items(category, sort_order, id);

ALTER TABLE public.shop_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_items_read_catalog
  ON public.shop_items FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.shop_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shop_items TO authenticated;

-- Current bundled catalog. Future sets are rows, not new RPCs/migrations.
INSERT INTO public.shop_items
  (id, title, description, category, price_gem, asset_key, active, enabled, is_default, sort_order)
VALUES
  ('table-classic', 'Classic table', 'Classic Okey set.', 'tables', 0, 'table-classic', true, true, true, 10),
  ('table-midnight', 'Midnight table', 'Purple Okey set.', 'tables', 350, 'table-midnight', true, true, false, 20),
  ('table-royal', 'Royal table', 'Black and gold Okey set.', 'tables', 520, 'table-royal', true, true, false, 30),
  ('table-emerald-ivory', 'Emerald Ivory', 'Emerald and ivory Okey set.', 'tables', 900, 'table-emerald-ivory', true, true, false, 40),
  ('table-zagros', 'Zagros', 'Zagros Okey set.', 'tables', 1200, 'table-zagros', true, true, false, 50),
  ('domino-classic', 'Classic Domino', 'Classic Domino set.', 'domino-skins', 0, 'domino-classic', true, true, true, 10),
  ('domino-emerald-ivory', 'Emerald Ivory', 'Emerald Ivory Domino set.', 'domino-skins', 430, 'domino-emerald-ivory', true, true, false, 20);

COMMIT;

