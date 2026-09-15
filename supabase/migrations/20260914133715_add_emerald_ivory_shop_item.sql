INSERT INTO public.shop_items (
  id,
  title,
  description,
  category,
  price_gem,
  asset_key,
  sort_order
)
VALUES (
  'table-emerald-ivory',
  'Emerald Ivory',
  'Emerald and ivory Okey set.',
  'tables',
  900,
  'table-emerald-ivory',
  40
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  price_gem = EXCLUDED.price_gem,
  asset_key = EXCLUDED.asset_key,
  sort_order = EXCLUDED.sort_order,
  active = true,
  updated_at = now();