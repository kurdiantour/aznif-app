-- Extend the existing two-player party so it can drive every team game.
-- Solo/1v1 matchmaking remains independent and never reads party state.

ALTER TABLE public.domino_parties
  ADD COLUMN IF NOT EXISTS current_game text,
  ADD COLUMN IF NOT EXISTS current_table_id text;

ALTER TABLE public.domino_parties
  DROP CONSTRAINT IF EXISTS domino_parties_current_game_check;
ALTER TABLE public.domino_parties
  ADD CONSTRAINT domino_parties_current_game_check
  CHECK (current_game IS NULL OR current_game IN ('domino', 'okey'));

CREATE OR REPLACE FUNCTION public.normalize_team_party_flow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.flow_status = 'idle' THEN
    NEW.current_game := NULL;
    NEW.current_room_id := NULL;
    NEW.current_mode := NULL;
    NEW.current_currency := NULL;
    NEW.current_entry_fee := NULL;
    NEW.current_table_id := NULL;
  ELSIF NEW.current_game IS NULL THEN
    -- Existing Domino RPCs predate current_game and identify themselves by 2v2.
    NEW.current_game := 'domino';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_team_party_flow_trigger
  ON public.domino_parties;
CREATE TRIGGER normalize_team_party_flow_trigger
BEFORE INSERT OR UPDATE ON public.domino_parties
FOR EACH ROW EXECUTE FUNCTION public.normalize_team_party_flow();

CREATE OR REPLACE FUNCTION public.get_my_domino_party()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_party public.domino_parties%ROWTYPE;
  v_members jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT p.* INTO v_party
  FROM public.domino_parties p
  JOIN public.domino_party_members pm ON pm.party_id = p.id
  WHERE pm.user_id = auth.uid() AND p.status = 'active'
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'user_id', pm.user_id,
    'role', pm.role,
    'avatar_id', pr.avatar_id,
    'name', coalesce(pr.full_name, pr.username, pm.user_id::text)
  ) ORDER BY CASE WHEN pm.role = 'leader' THEN 0 ELSE 1 END)
  INTO v_members
  FROM public.domino_party_members pm
  LEFT JOIN public.profiles pr ON pr.id = pm.user_id
  WHERE pm.party_id = v_party.id;

  RETURN jsonb_build_object(
    'id', v_party.id,
    'leader_id', v_party.leader_id,
    'status', v_party.status,
    'flow_status', v_party.flow_status,
    'current_game', v_party.current_game,
    'current_room_id', v_party.current_room_id,
    'current_mode', v_party.current_mode,
    'current_currency', v_party.current_currency,
    'current_entry_fee', v_party.current_entry_fee,
    'current_table_id', v_party.current_table_id,
    'command_version', v_party.command_version,
    'updated_at', v_party.updated_at,
    'members', coalesce(v_members, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_domino_party() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_domino_party() TO authenticated;
