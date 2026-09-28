INSERT INTO public.shop_items (
    id, 
    category, 
    title, 
    description, 
    asset_key, 
    price_gem, 
    sort_order, 
    enabled, 
    is_default
) VALUES (
    'table-goizha', 
    'tables', 
    'Goizha', 
    'Goizha Okey Set', 
    'table-goizha', 
    1100, 
    100, 
    true, 
    false
) ON CONFLICT (id) DO UPDATE SET 
    price_gem = EXCLUDED.price_gem,
    title = EXCLUDED.title,
    asset_key = EXCLUDED.asset_key;
