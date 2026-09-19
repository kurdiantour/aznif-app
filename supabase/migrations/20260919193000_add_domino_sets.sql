ALTER TABLE public.shop_items 
ADD COLUMN IF NOT EXISTS free_from TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS free_until TIMESTAMPTZ;

CREATE OR REPLACE VIEW public.resolved_user_equipped_items AS
SELECT
    e.user_id,
    e.category,
    CASE
        WHEN u.item_id IS NOT NULL THEN e.item_id
        WHEN s.price_gold = 0 THEN e.item_id
        WHEN s.free_from IS NOT NULL AND s.free_until IS NOT NULL AND s.free_from <= now() AND s.free_until >= now() THEN e.item_id
        WHEN e.category = 'domino-skins' THEN 'domino-classic'
        WHEN e.category = 'tables' THEN 'table-classic'
        WHEN e.category = 'profile-covers' THEN 'cover-dusk'
        ELSE e.item_id
    END as item_id,
    e.equipped_at
FROM public.user_equipped_shop_items e
JOIN public.shop_items s ON s.id = e.item_id
LEFT JOIN public.user_shop_items u ON u.user_id = e.user_id AND u.item_id = e.item_id;

GRANT SELECT ON public.resolved_user_equipped_items TO authenticated;

-- Replace user_equipped_shop_items with resolved_user_equipped_items in multiplayer queries

CREATE OR REPLACE FUNCTION public.get_multiplayer_room_cosmetics(
  p_room_id uuid,
  p_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_table_id text;
  v_player_tables jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_mode = '1v1' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.one_vs_one_players
      WHERE room_id = p_room_id AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'Not a member of this room';
    END IF;

    SELECT equipped.item_id
    INTO v_table_id
    FROM public.one_vs_one_players AS player
    JOIN public.resolved_user_equipped_items AS equipped
      ON equipped.user_id = player.user_id AND equipped.category = 'tables'
    JOIN public.shop_items AS item ON item.id = equipped.item_id
    WHERE player.room_id = p_room_id
    ORDER BY item.price_gold DESC, item.sort_order DESC, equipped.item_id ASC
    LIMIT 1;

    SELECT jsonb_object_agg(player.user_id, equipped.item_id)
    INTO v_player_tables
    FROM public.one_vs_one_players AS player
    JOIN public.resolved_user_equipped_items AS equipped
      ON equipped.user_id = player.user_id AND equipped.category = 'tables'
    WHERE player.room_id = p_room_id AND player.user_id IS NOT NULL;

  ELSIF p_mode = '2v2' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.two_vs_two_players
      WHERE room_id = p_room_id AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'Not a member of this room';
    END IF;

    SELECT equipped.item_id
    INTO v_table_id
    FROM public.two_vs_two_players AS player
    JOIN public.resolved_user_equipped_items AS equipped
      ON equipped.user_id = player.user_id AND equipped.category = 'tables'
    JOIN public.shop_items AS item ON item.id = equipped.item_id
    WHERE player.room_id = p_room_id
    ORDER BY item.price_gold DESC, item.sort_order DESC, equipped.item_id ASC
    LIMIT 1;

    SELECT jsonb_object_agg(player.user_id, equipped.item_id)
    INTO v_player_tables
    FROM public.two_vs_two_players AS player
    JOIN public.resolved_user_equipped_items AS equipped
      ON equipped.user_id = player.user_id AND equipped.category = 'tables'
    WHERE player.room_id = p_room_id AND player.user_id IS NOT NULL;
  ELSE
    RAISE EXCEPTION 'Unsupported game mode';
  END IF;

  RETURN jsonb_build_object(
    'activeTableId', COALESCE(v_table_id, 'table-classic'),
    'playerTables', COALESCE(v_player_tables, '{}'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_multiplayer_room_cosmetics(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_multiplayer_room_cosmetics(uuid, text) TO authenticated;

-- Also update get_multiplayer_room_table (older shared function)
CREATE OR REPLACE FUNCTION public.get_multiplayer_room_table(
  p_room_id uuid,
  p_mode text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_table_id text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_mode = '1v1' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.one_vs_one_players
      WHERE room_id = p_room_id AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'Not a member of this room';
    END IF;

    SELECT equipped.item_id
    INTO v_table_id
    FROM public.one_vs_one_players AS player
    JOIN public.resolved_user_equipped_items AS equipped
      ON equipped.user_id = player.user_id AND equipped.category = 'tables'
    JOIN public.shop_items AS item ON item.id = equipped.item_id
    WHERE player.room_id = p_room_id
    ORDER BY item.price_gold DESC, item.sort_order DESC, equipped.item_id ASC
    LIMIT 1;
  ELSIF p_mode = '2v2' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.two_vs_two_players
      WHERE room_id = p_room_id AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'Not a member of this room';
    END IF;

    SELECT equipped.item_id
    INTO v_table_id
    FROM public.two_vs_two_players AS player
    JOIN public.resolved_user_equipped_items AS equipped
      ON equipped.user_id = player.user_id AND equipped.category = 'tables'
    JOIN public.shop_items AS item ON item.id = equipped.item_id
    WHERE player.room_id = p_room_id
    ORDER BY item.price_gold DESC, item.sort_order DESC, equipped.item_id ASC
    LIMIT 1;
  ELSE
    RAISE EXCEPTION 'Unsupported game mode';
  END IF;

  RETURN COALESCE(v_table_id, 'table-classic');
END;
$$;
REVOKE ALL ON FUNCTION public.get_multiplayer_room_table(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_multiplayer_room_table(uuid, text) TO authenticated;

-- Update purchase_or_equip_shop_item logic for temp-free items
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
  v_is_temp_free boolean;
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

  v_is_temp_free := v_item.free_from IS NOT NULL AND v_item.free_until IS NOT NULL AND v_item.free_from <= now() AND v_item.free_until >= now();

  IF v_already_owned OR v_is_temp_free THEN
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

INSERT INTO public.shop_items (
  id,
  title,
  description,
  category,
  price_gold,
  asset_key,
  sort_order
)
VALUES (
  'domino-classic',
  'دۆمینۆی کلاسیک',
  'Classic Domino Set.',
  'domino-skins',
  0,
  'domino-classic',
  10
),
(
  'domino-emerald-ivory',
  'Emerald Ivory',
  'Emerald Ivory Domino Set.',
  'domino-skins',
  430,
  'domino-emerald-ivory',
  20
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  price_gold = EXCLUDED.price_gold,
  asset_key = EXCLUDED.asset_key,
  sort_order = EXCLUDED.sort_order,
  active = true,
  updated_at = now();

-- Ensure all users own the free classic set
INSERT INTO public.user_shop_items (user_id, item_id)
SELECT id, 'domino-classic'
FROM auth.users
ON CONFLICT (user_id, item_id) DO NOTHING;

-- Make classic the default equipped set if nothing is equipped
INSERT INTO public.user_equipped_shop_items (user_id, category, item_id, equipped_at)
SELECT id, 'domino-skins', 'domino-classic', now()
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_equipped_shop_items e
  WHERE e.user_id = u.id
    AND e.category = 'domino-skins'
)
ON CONFLICT (user_id, category) DO NOTHING;

-- Use an independent trigger to grant domino-classic to new users
CREATE OR REPLACE FUNCTION public.handle_new_user_domino_classic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_shop_items (user_id, item_id)
  VALUES (NEW.id, 'domino-classic')
  ON CONFLICT (user_id, item_id) DO NOTHING;

  INSERT INTO public.user_equipped_shop_items (user_id, category, item_id, equipped_at)
  VALUES (NEW.id, 'domino-skins', 'domino-classic', now())
  ON CONFLICT (user_id, category) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_domino_classic ON auth.users;
CREATE TRIGGER on_auth_user_created_domino_classic
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_domino_classic();
