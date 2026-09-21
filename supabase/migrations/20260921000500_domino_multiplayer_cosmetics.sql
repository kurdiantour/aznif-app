-- Domino multiplayer cosmetics: live room resolution + immutable match snapshot.
BEGIN;

ALTER TABLE public.one_vs_one_rooms ADD COLUMN IF NOT EXISTS cosmetics_snapshot jsonb;
ALTER TABLE public.two_vs_two_rooms ADD COLUMN IF NOT EXISTS cosmetics_snapshot jsonb;

CREATE FUNCTION public.compute_domino_room_cosmetics(p_room_id uuid, p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public STABLE AS $$
DECLARE
  v_shared_set_asset_key text := 'domino-classic';
  v_player_set_asset_keys jsonb := '{}'::jsonb;
BEGIN
  IF p_room_id IS NULL THEN RAISE EXCEPTION 'room_id_required' USING errcode = '22023'; END IF;

  IF p_mode = '1v1' THEN
    SELECT resolved.asset_key INTO v_shared_set_asset_key
    FROM public.one_vs_one_players AS player
    CROSS JOIN LATERAL shop_private.resolve_multiplayer_cosmetic(player.user_id, 'domino-skins') AS resolved
    WHERE player.room_id = p_room_id AND player.user_id IS NOT NULL AND player.left_at IS NULL
    ORDER BY resolved.price_gem DESC, resolved.asset_key ASC LIMIT 1;

    SELECT COALESCE(jsonb_object_agg(player.user_id::text, resolved.asset_key), '{}'::jsonb)
    INTO v_player_set_asset_keys
    FROM public.one_vs_one_players AS player
    CROSS JOIN LATERAL shop_private.resolve_multiplayer_cosmetic(player.user_id, 'domino-skins') AS resolved
    WHERE player.room_id = p_room_id AND player.user_id IS NOT NULL AND player.left_at IS NULL;

  ELSIF p_mode = '2v2' THEN
    SELECT resolved.asset_key INTO v_shared_set_asset_key
    FROM public.two_vs_two_players AS player
    CROSS JOIN LATERAL shop_private.resolve_multiplayer_cosmetic(player.user_id, 'domino-skins') AS resolved
    WHERE player.room_id = p_room_id AND player.user_id IS NOT NULL AND player.left_at IS NULL
    ORDER BY resolved.price_gem DESC, resolved.asset_key ASC LIMIT 1;

    SELECT COALESCE(jsonb_object_agg(player.user_id::text, resolved.asset_key), '{}'::jsonb)
    INTO v_player_set_asset_keys
    FROM public.two_vs_two_players AS player
    CROSS JOIN LATERAL shop_private.resolve_multiplayer_cosmetic(player.user_id, 'domino-skins') AS resolved
    WHERE player.room_id = p_room_id AND player.user_id IS NOT NULL AND player.left_at IS NULL;
  ELSE
    RAISE EXCEPTION 'unsupported_domino_mode' USING errcode = '22023';
  END IF;

  RETURN jsonb_build_object(
    'shared_set_asset_key', COALESCE(NULLIF(btrim(v_shared_set_asset_key), ''), 'domino-classic'),
    'player_set_asset_keys', COALESCE(v_player_set_asset_keys, '{}'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.compute_domino_room_cosmetics(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_domino_room_cosmetics(uuid, text) TO service_role;

CREATE FUNCTION public.resolve_domino_room_cosmetics(p_room_id uuid, p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public STABLE AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_snapshot jsonb;
  v_status text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING errcode = '42501'; END IF;
  IF p_room_id IS NULL THEN RAISE EXCEPTION 'room_id_required' USING errcode = '22023'; END IF;

  IF p_mode = '1v1' THEN
    IF NOT EXISTS (SELECT 1 FROM public.one_vs_one_players WHERE room_id = p_room_id AND user_id = v_user_id AND left_at IS NULL)
      THEN RAISE EXCEPTION 'active_room_membership_required' USING errcode = '42501'; END IF;
    SELECT cosmetics_snapshot, status INTO v_snapshot, v_status FROM public.one_vs_one_rooms WHERE id = p_room_id;
  ELSIF p_mode = '2v2' THEN
    IF NOT EXISTS (SELECT 1 FROM public.two_vs_two_players WHERE room_id = p_room_id AND user_id = v_user_id AND left_at IS NULL)
      THEN RAISE EXCEPTION 'active_room_membership_required' USING errcode = '42501'; END IF;
    SELECT cosmetics_snapshot, status INTO v_snapshot, v_status FROM public.two_vs_two_rooms WHERE id = p_room_id;
  ELSE
    RAISE EXCEPTION 'unsupported_domino_mode' USING errcode = '22023';
  END IF;

  IF v_snapshot IS NOT NULL THEN RETURN v_snapshot; END IF;
  IF v_status <> 'waiting' THEN RAISE EXCEPTION 'cosmetics_snapshot_missing' USING errcode = 'P0001'; END IF;
  RETURN public.compute_domino_room_cosmetics(p_room_id, p_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_domino_room_cosmetics(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_domino_room_cosmetics(uuid, text) TO authenticated;

CREATE FUNCTION public.lock_one_vs_one_cosmetics_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.cosmetics_snapshot IS NOT NULL THEN NEW.cosmetics_snapshot := OLD.cosmetics_snapshot; RETURN NEW; END IF;
  IF OLD.status = 'waiting' AND NEW.status = 'active' THEN
    NEW.cosmetics_snapshot := public.compute_domino_room_cosmetics(NEW.id, '1v1') || '{"locked":true}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_one_vs_one_cosmetics_snapshot() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_one_vs_one_lock_cosmetics_snapshot ON public.one_vs_one_rooms;
CREATE TRIGGER trg_one_vs_one_lock_cosmetics_snapshot
BEFORE UPDATE OF status, cosmetics_snapshot ON public.one_vs_one_rooms
FOR EACH ROW EXECUTE FUNCTION public.lock_one_vs_one_cosmetics_snapshot();

CREATE FUNCTION public.lock_two_vs_two_cosmetics_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.cosmetics_snapshot IS NOT NULL THEN NEW.cosmetics_snapshot := OLD.cosmetics_snapshot; RETURN NEW; END IF;
  IF OLD.status = 'waiting' AND NEW.status = 'active' THEN
    NEW.cosmetics_snapshot := public.compute_domino_room_cosmetics(NEW.id, '2v2') || '{"locked":true}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_two_vs_two_cosmetics_snapshot() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_two_vs_two_lock_cosmetics_snapshot ON public.two_vs_two_rooms;
CREATE TRIGGER trg_two_vs_two_lock_cosmetics_snapshot
BEFORE UPDATE OF status, cosmetics_snapshot ON public.two_vs_two_rooms
FOR EACH ROW EXECUTE FUNCTION public.lock_two_vs_two_cosmetics_snapshot();

-- Public 1v1 can still be waiting after both seats have been assigned.
-- Lock at roster completion, before countdown/preload; later membership cannot rewrite it.
CREATE FUNCTION shop_private.lock_domino_roster_cosmetics()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_snapshot jsonb;
  v_status text;
  v_count integer;
BEGIN
  IF TG_TABLE_NAME = 'one_vs_one_players' THEN
    SELECT status, cosmetics_snapshot INTO v_status, v_snapshot
    FROM public.one_vs_one_rooms WHERE id = NEW.room_id FOR UPDATE;
    IF v_status = 'waiting' AND v_snapshot IS NULL THEN
      SELECT count(*) INTO v_count FROM public.one_vs_one_players WHERE room_id = NEW.room_id AND left_at IS NULL;
      IF v_count = 2 THEN
        UPDATE public.one_vs_one_rooms
        SET cosmetics_snapshot = public.compute_domino_room_cosmetics(NEW.room_id, '1v1') || '{"locked":true}'::jsonb
        WHERE id = NEW.room_id;
      END IF;
    END IF;
  ELSE
    SELECT status, cosmetics_snapshot INTO v_status, v_snapshot
    FROM public.two_vs_two_rooms WHERE id = NEW.room_id FOR UPDATE;
    IF v_status = 'waiting' AND v_snapshot IS NULL THEN
      SELECT count(*) INTO v_count FROM public.two_vs_two_players WHERE room_id = NEW.room_id AND left_at IS NULL;
      IF v_count = 4 THEN
        UPDATE public.two_vs_two_rooms
        SET cosmetics_snapshot = public.compute_domino_room_cosmetics(NEW.room_id, '2v2') || '{"locked":true}'::jsonb
        WHERE id = NEW.room_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION shop_private.lock_domino_roster_cosmetics() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER lock_one_vs_one_roster_cosmetics
AFTER INSERT OR UPDATE OF user_id, left_at ON public.one_vs_one_players
FOR EACH ROW EXECUTE FUNCTION shop_private.lock_domino_roster_cosmetics();
CREATE TRIGGER lock_two_vs_two_roster_cosmetics
AFTER INSERT OR UPDATE OF user_id, left_at ON public.two_vs_two_players
FOR EACH ROW EXECUTE FUNCTION shop_private.lock_domino_roster_cosmetics();

COMMIT;

