-- Atomically persist the public state, private hands, and move audit record.
CREATE OR REPLACE FUNCTION public.commit_multiplayer_action(
  p_mode text,
  p_room_id uuid,
  p_expected_version bigint,
  p_state jsonb,
  p_hands jsonb,
  p_boneyard jsonb,
  p_current_turn_player_id uuid,
  p_status text,
  p_player_id uuid,
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room jsonb;
  v_sequence bigint;
  v_effective_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  IF p_mode = '1v1' THEN
    UPDATE public.one_vs_one_rooms
    SET state = p_state,
        version = version + 1,
        current_turn_player_id = p_current_turn_player_id,
        status = COALESCE(p_status, status),
        updated_at = now()
    WHERE id = p_room_id AND version = p_expected_version
    RETURNING to_jsonb(one_vs_one_rooms.*), status INTO v_room, v_effective_status;

    IF NOT FOUND THEN RAISE EXCEPTION 'STALE_GAME_STATE'; END IF;

    INSERT INTO public.one_vs_one_private_states(room_id, hands, boneyard)
    VALUES (p_room_id, p_hands, p_boneyard)
    ON CONFLICT (room_id) DO UPDATE
    SET hands = EXCLUDED.hands, boneyard = EXCLUDED.boneyard, updated_at = now();

    v_sequence := public.next_one_vs_one_move_sequence(p_room_id);
    INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
    VALUES (p_room_id, p_player_id, v_sequence, p_action, COALESCE(p_payload, '{}'::jsonb));
  ELSIF p_mode = '2v2' THEN
    UPDATE public.two_vs_two_rooms
    SET state = p_state,
        version = version + 1,
        current_turn_player_id = p_current_turn_player_id,
        status = COALESCE(p_status, status),
        updated_at = now()
    WHERE id = p_room_id AND version = p_expected_version
    RETURNING to_jsonb(two_vs_two_rooms.*), status INTO v_room, v_effective_status;

    IF NOT FOUND THEN RAISE EXCEPTION 'STALE_GAME_STATE'; END IF;

    INSERT INTO public.two_vs_two_private_states(room_id, hands, boneyard)
    VALUES (p_room_id, p_hands, p_boneyard)
    ON CONFLICT (room_id) DO UPDATE
    SET hands = EXCLUDED.hands, boneyard = EXCLUDED.boneyard, updated_at = now();

    v_sequence := public.next_two_vs_two_move_sequence(p_room_id);
    INSERT INTO public.two_vs_two_moves(room_id, player_id, sequence, action, payload)
    VALUES (p_room_id, p_player_id, v_sequence, p_action, COALESCE(p_payload, '{}'::jsonb));
  ELSE
    RAISE EXCEPTION 'Invalid game mode';
  END IF;

  IF v_effective_status = 'finished' THEN
    PERFORM public.settle_finished_match_rewards(p_mode, p_room_id);
  END IF;

  RETURN v_room;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_multiplayer_action(
  text, uuid, bigint, jsonb, jsonb, jsonb, uuid, text, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_multiplayer_action(
  text, uuid, bigint, jsonb, jsonb, jsonb, uuid, text, uuid, text, jsonb
) TO service_role;
