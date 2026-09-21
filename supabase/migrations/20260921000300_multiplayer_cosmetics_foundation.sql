-- Shared multiplayer-cosmetics foundation.
-- Resolves an equipped set only when the player still has effective entitlement.
BEGIN;

CREATE FUNCTION shop_private.resolve_multiplayer_cosmetic(
  p_user_id uuid,
  p_category text
)
RETURNS TABLE(asset_key text, price_gem integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH candidate AS (
    SELECT s AS item,
      EXISTS (
        SELECT 1 FROM public.user_shop_items AS owned
        WHERE owned.user_id = p_user_id AND owned.item_id = s.id
      ) AS owned
    FROM public.user_equipped_shop_items AS equipped
    JOIN public.shop_items AS s
      ON s.id = equipped.item_id AND s.category = equipped.category
    WHERE equipped.user_id = p_user_id
      AND equipped.category = p_category
  ), valid_candidate AS (
    -- Owned, unpriced sets retain entitlement; shared-selection rank is zero.
    SELECT (c.item).asset_key, COALESCE((c.item).price_gem, 0) AS price_gem
    FROM candidate AS c
    WHERE shop_private.access_kind(c.item, c.owned, statement_timestamp()) IS NOT NULL
      AND btrim((c.item).asset_key) <> ''
  ), fallback AS (
    SELECT d.asset_key, d.price_gem
    FROM public.shop_items AS d
    WHERE d.category = p_category
      AND d.is_default
      AND d.enabled
      AND d.price_gem IS NOT NULL
      AND btrim(d.asset_key) <> ''
    LIMIT 1
  )
  SELECT * FROM valid_candidate
  UNION ALL
  SELECT * FROM fallback WHERE NOT EXISTS (SELECT 1 FROM valid_candidate)
  LIMIT 1;
$$;

GRANT USAGE ON SCHEMA shop_private TO service_role;
REVOKE ALL ON FUNCTION shop_private.resolve_multiplayer_cosmetic(uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION shop_private.resolve_multiplayer_cosmetic(uuid, text) TO service_role;

-- Legacy generic RPCs are intentionally not part of the new architecture.
DROP FUNCTION IF EXISTS public.get_multiplayer_room_table(uuid, text);
DROP FUNCTION IF EXISTS public.get_multiplayer_room_cosmetics(uuid, text);

COMMIT;

