-- Cancel the existing shared Domino/Okey party from either side.
-- This extends the current party model; it does not introduce a parallel party.

CREATE OR REPLACE FUNCTION public.cancel_game_party()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_party public.domino_parties%ROWTYPE;
  v_users uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  SELECT p.*
  INTO v_party
  FROM public.domino_parties p
  JOIN public.domino_party_members pm ON pm.party_id = p.id
  WHERE pm.user_id = v_uid
    AND p.status = 'active'
  LIMIT 1
  FOR UPDATE OF p;

  -- A retry after the first successful cancellation is a successful no-op.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'already_cancelled');
  END IF;

  SELECT array_agg(pm.user_id ORDER BY pm.joined_at)
  INTO v_users
  FROM public.domino_party_members pm
  WHERE pm.party_id = v_party.id;

  -- Stop a Domino waiting/searching flow for both party members.
  UPDATE public.two_vs_two_matchmaking_queue
  SET status = 'cancelled', ended_at = now(), updated_at = now()
  WHERE user_id = ANY(v_users)
    AND status IN ('searching', 'matched');

  IF v_party.current_game = 'domino' AND v_party.current_room_id IS NOT NULL THEN
    UPDATE public.two_vs_two_players
    SET connected = false, left_at = COALESCE(left_at, now()), updated_at = now()
    WHERE room_id = v_party.current_room_id
      AND user_id = ANY(v_users)
      AND EXISTS (
        SELECT 1 FROM public.two_vs_two_rooms r
        WHERE r.id = v_party.current_room_id AND r.status = 'waiting'
      );

    UPDATE public.two_vs_two_rooms
    SET status = 'cancelled', version = version + 1, updated_at = now()
    WHERE id = v_party.current_room_id AND status = 'waiting';
  END IF;

  -- Stop an Okey waiting flow for both party members. Active matches are not
  -- forfeited by this lobby-level operation; only the future follow link ends.
  IF v_party.current_game = 'okey' AND v_party.current_room_id IS NOT NULL THEN
    DELETE FROM okey.match_seats s
    USING okey.matches m
    WHERE s.match_id = m.id
      AND m.id = v_party.current_room_id
      AND m.status = 'waiting'
      AND s.user_id = ANY(v_users);

    UPDATE okey.matches
    SET status = 'cancelled', countdown_deadline_at = NULL, updated_at = now()
    WHERE id = v_party.current_room_id
      AND status = 'waiting'
      AND NOT EXISTS (
        SELECT 1 FROM okey.match_seats s WHERE s.match_id = v_party.current_room_id
      );
  END IF;

  -- Update first so the existing Realtime subscription observes cancellation
  -- while both users still satisfy the party RLS membership policy.
  UPDATE public.domino_parties
  SET status = 'disbanded',
      flow_status = 'idle',
      current_game = NULL,
      current_room_id = NULL,
      current_mode = NULL,
      current_currency = NULL,
      current_entry_fee = NULL,
      current_table_id = NULL,
      command_version = command_version + 1,
      updated_at = now()
  WHERE id = v_party.id AND status = 'active';

  -- Updating the accepted invite gives both participants a Realtime event even
  -- after membership rows are removed (game_invites RLS is participant-based).
  UPDATE public.game_invites
  SET status = 'cancelled', responded_at = COALESCE(responded_at, now()), updated_at = now()
  WHERE (party_id = v_party.id AND status = 'accepted')
     OR (
       status = 'pending'
       AND (sender_id = ANY(v_users) OR recipient_id = ANY(v_users))
     );

  -- The existing UNIQUE(user_id) constraint now releases both users so they
  -- can immediately form another party.
  DELETE FROM public.domino_party_members WHERE party_id = v_party.id;

  RETURN jsonb_build_object('status', 'cancelled', 'party_id', v_party.id);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_game_party() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_game_party() TO authenticated;

