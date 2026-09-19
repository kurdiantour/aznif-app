-- SECURITY DEFINER is required because equipped cosmetics are otherwise private.
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
    JOIN public.user_equipped_shop_items AS equipped
      ON equipped.user_id = player.user_id AND equipped.category = 'tables'
    JOIN public.shop_items AS item ON item.id = equipped.item_id
    WHERE player.room_id = p_room_id
    ORDER BY item.price_gold DESC, item.sort_order DESC, equipped.item_id ASC
    LIMIT 1;

    SELECT jsonb_object_agg(player.user_id, equipped.item_id)
    INTO v_player_tables
    FROM public.one_vs_one_players AS player
    JOIN public.user_equipped_shop_items AS equipped
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
    JOIN public.user_equipped_shop_items AS equipped
      ON equipped.user_id = player.user_id AND equipped.category = 'tables'
    JOIN public.shop_items AS item ON item.id = equipped.item_id
    WHERE player.room_id = p_room_id
    ORDER BY item.price_gold DESC, item.sort_order DESC, equipped.item_id ASC
    LIMIT 1;

    SELECT jsonb_object_agg(player.user_id, equipped.item_id)
    INTO v_player_tables
    FROM public.two_vs_two_players AS player
    JOIN public.user_equipped_shop_items AS equipped
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
