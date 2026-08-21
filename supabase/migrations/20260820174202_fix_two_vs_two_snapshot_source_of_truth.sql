-- The room row is the canonical public-state/version authority after the 2v2
-- architecture migration. Reading the superseded public-state mirror could pair
-- an old board with the room's new version and make a valid hand appear stale.
--
-- The canonical economy result also lives on two_vs_two_rooms.settlement.
-- Project it into the snapshot state consumed by the game UI so legal finishes,
-- takeover finishes, and resumed finished matches all expose the same settlement
-- payload without duplicating the source of truth in room.state.
CREATE OR REPLACE FUNCTION public.get_two_vs_two_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_private public.two_vs_two_private_states%ROWTYPE;
  v_player_index integer;
  v_hand jsonb := '[]'::jsonb;
  v_state jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT player.player_index
  INTO v_player_index
  FROM public.two_vs_two_players AS player
  WHERE player.room_id = p_room_id
    AND player.user_id = v_user_id;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'You are not a player in this 2v2 room';
  END IF;

  SELECT *
  INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  SELECT *
  INTO v_private
  FROM public.two_vs_two_private_states
  WHERE room_id = p_room_id;

  IF FOUND THEN
    v_hand := COALESCE(v_private.hands -> v_player_index, '[]'::jsonb);
  END IF;

  v_state := COALESCE(v_room.state, '{}'::jsonb)
    || jsonb_build_object('myHand', v_hand);

  IF v_room.settlement IS NOT NULL THEN
    v_state := v_state || jsonb_build_object(
      'settlement', v_room.settlement,
      'onlineMatchResultReward', v_room.settlement
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_room.id,
    'status', v_room.status,
    'version', v_room.version,
    'current_turn_player_id', v_room.current_turn_player_id,
    'myPlayerIndex', v_player_index,
    'state', v_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_two_vs_two_snapshot(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_two_vs_two_snapshot(uuid)
TO authenticated;

NOTIFY pgrst, 'reload schema';