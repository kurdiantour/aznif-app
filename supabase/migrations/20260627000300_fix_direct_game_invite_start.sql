-- Keep accepted friend invitations on the normal matched-game path and ensure
-- move audit sequences advance through the room's atomic counter.

CREATE OR REPLACE FUNCTION public.respond_game_invite(p_invite_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_invite public.game_invites%ROWTYPE;
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_sender_status text;
  v_sender_seen timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_invite FROM public.game_invites
  WHERE id = p_invite_id AND recipient_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_invite.status <> 'pending' THEN RAISE EXCEPTION 'Pending invitation not found'; END IF;
  IF v_invite.expires_at <= now() THEN
    UPDATE public.game_invites SET status = 'expired', updated_at = now() WHERE id = p_invite_id;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF NOT p_accept THEN
    UPDATE public.game_invites SET status = 'declined', responded_at = now(), updated_at = now()
    WHERE id = p_invite_id;
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  IF NOT public.are_friends(v_invite.sender_id, v_invite.recipient_id) THEN
    RAISE EXCEPTION 'Players are no longer friends';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_presence
    WHERE user_id = v_invite.recipient_id
      AND status = 'online_available'
      AND last_seen_at >= now() - interval '35 seconds'
  ) THEN RAISE EXCEPTION 'You are no longer available'; END IF;
  SELECT status, last_seen_at INTO v_sender_status, v_sender_seen
  FROM public.user_presence WHERE user_id = v_invite.sender_id;
  IF v_sender_status IS DISTINCT FROM 'online_available'
     OR v_sender_seen IS NULL OR v_sender_seen < now() - interval '35 seconds' THEN
    RAISE EXCEPTION 'Inviting player is no longer available';
  END IF;

  INSERT INTO public.one_vs_one_rooms(host_user_id, room_code, status, bet_amount, player_count, metadata)
  VALUES (v_invite.sender_id, public.generate_one_vs_one_room_code(), 'active', 0, 2,
          jsonb_build_object('game_invite_id', v_invite.id))
  RETURNING * INTO v_room;

  INSERT INTO public.one_vs_one_players
    (room_id, user_id, kind, seat, team_id, player_index, is_ready, connected)
  VALUES
    (v_room.id, v_invite.sender_id, 'human', 'bottom', 'teamA', 0, true, true),
    (v_room.id, v_invite.recipient_id, 'human', 'top', 'teamB', 1, true, true);

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (v_room.id, v_invite.sender_id, public.next_one_vs_one_move_sequence(v_room.id),
          'room_created', jsonb_build_object('game_invite_id', v_invite.id));
  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES (v_room.id, v_invite.recipient_id, public.next_one_vs_one_move_sequence(v_room.id),
          'room_joined', jsonb_build_object('game_invite_id', v_invite.id));

  UPDATE public.game_invites
  SET status = 'accepted', room_id = v_room.id, responded_at = now(), updated_at = now()
  WHERE id = v_invite.id;
  UPDATE public.game_invites
  SET status = 'cancelled', responded_at = now(), updated_at = now()
  WHERE status = 'pending' AND id <> v_invite.id
    AND (sender_id IN (v_invite.sender_id, v_invite.recipient_id)
         OR recipient_id IN (v_invite.sender_id, v_invite.recipient_id));
  UPDATE public.user_presence SET status = 'matchmaking', updated_at = now(), last_seen_at = now()
  WHERE user_id IN (v_invite.sender_id, v_invite.recipient_id);

  RETURN jsonb_build_object('status', 'accepted', 'room_id', v_room.id);
END;
$$;
REVOKE ALL ON FUNCTION public.respond_game_invite(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_game_invite(uuid, boolean) TO authenticated;
