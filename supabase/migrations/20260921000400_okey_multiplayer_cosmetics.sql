-- Okey multiplayer cosmetics: live waiting-room resolution + immutable match snapshot.
BEGIN;

ALTER TABLE okey.matches ADD COLUMN IF NOT EXISTS cosmetics_snapshot jsonb;

CREATE FUNCTION public.resolve_okey_match_cosmetics(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, okey STABLE AS $$
DECLARE
  v_snapshot jsonb;
  v_status text;
  v_shared_set_asset_key text := 'table-classic';
  v_player_set_asset_keys jsonb := '{}'::jsonb;
BEGIN
  IF p_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required' USING errcode = '22023'; END IF;

  SELECT m.cosmetics_snapshot, m.status INTO v_snapshot, v_status FROM okey.matches AS m WHERE m.id = p_match_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found' USING errcode = 'P0001'; END IF;
  IF v_snapshot IS NOT NULL THEN RETURN v_snapshot; END IF;
  IF v_status <> 'waiting' THEN RAISE EXCEPTION 'cosmetics_snapshot_missing' USING errcode = 'P0001'; END IF;

  SELECT resolved.asset_key INTO v_shared_set_asset_key
  FROM okey.match_seats AS seat
  CROSS JOIN LATERAL shop_private.resolve_multiplayer_cosmetic(seat.user_id, 'tables') AS resolved
  WHERE seat.match_id = p_match_id
    AND seat.user_id IS NOT NULL
    AND seat.membership_released_at IS NULL
  ORDER BY resolved.price_gem DESC, resolved.asset_key ASC
  LIMIT 1;

  SELECT COALESCE(jsonb_object_agg(seat.user_id::text, resolved.asset_key), '{}'::jsonb)
  INTO v_player_set_asset_keys
  FROM okey.match_seats AS seat
  CROSS JOIN LATERAL shop_private.resolve_multiplayer_cosmetic(seat.user_id, 'tables') AS resolved
  WHERE seat.match_id = p_match_id
    AND seat.user_id IS NOT NULL
    AND seat.membership_released_at IS NULL;

  RETURN jsonb_build_object(
    'shared_set_asset_key', COALESCE(NULLIF(btrim(v_shared_set_asset_key), ''), 'table-classic'),
    'player_set_asset_keys', COALESCE(v_player_set_asset_keys, '{}'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_okey_match_cosmetics(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_okey_match_cosmetics(uuid) TO service_role;

CREATE FUNCTION okey.lock_match_cosmetics_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, okey AS $$
BEGIN
  IF OLD.cosmetics_snapshot IS NOT NULL THEN
    NEW.cosmetics_snapshot := OLD.cosmetics_snapshot;
    RETURN NEW;
  END IF;
  -- The full roster's countdown is already part of the locked match.
  IF OLD.status = 'waiting' AND (NEW.countdown_deadline_at IS NOT NULL OR NEW.status = 'playing') THEN
    NEW.cosmetics_snapshot := public.resolve_okey_match_cosmetics(NEW.id) || '{"locked":true}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION okey.lock_match_cosmetics_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION okey.lock_match_cosmetics_snapshot() TO service_role;

DROP TRIGGER IF EXISTS trg_okey_matches_lock_cosmetics_snapshot ON okey.matches;
CREATE TRIGGER trg_okey_matches_lock_cosmetics_snapshot
BEFORE UPDATE OF status, countdown_deadline_at, cosmetics_snapshot ON okey.matches
FOR EACH ROW EXECUTE FUNCTION okey.lock_match_cosmetics_snapshot();

COMMIT;

