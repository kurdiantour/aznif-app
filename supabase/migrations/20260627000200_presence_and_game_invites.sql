-- Global player availability and secure 1v1 friend invitations.

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('online_available', 'matchmaking', 'in_game', 'away')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen
ON public.user_presence(last_seen_at DESC);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_presence_select_friends" ON public.user_presence;
CREATE POLICY "user_presence_select_friends"
ON public.user_presence FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.are_friends(auth.uid(), user_id)
);

REVOKE ALL ON public.user_presence FROM anon, authenticated;
GRANT SELECT ON public.user_presence TO authenticated;

CREATE OR REPLACE FUNCTION public.update_my_presence(p_status text)
RETURNS public.user_presence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_presence public.user_presence%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_status NOT IN ('online_available', 'matchmaking', 'in_game', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status';
  END IF;

  INSERT INTO public.user_presence(user_id, status, last_seen_at, updated_at)
  VALUES (auth.uid(), p_status, now(), now())
  ON CONFLICT (user_id) DO UPDATE
  SET status = EXCLUDED.status, last_seen_at = now(), updated_at = now()
  RETURNING * INTO v_presence;

  RETURN v_presence;
END;
$$;

CREATE TABLE IF NOT EXISTS public.game_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT '1v1' CHECK (mode IN ('1v1')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  room_id uuid REFERENCES public.one_vs_one_rooms(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 seconds'),
  responded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_game_invites_recipient_pending
ON public.game_invites(recipient_id, created_at DESC) WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_invites_one_pending_pair
ON public.game_invites(LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id))
WHERE status = 'pending';

ALTER TABLE public.game_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "game_invites_select_participants" ON public.game_invites;
CREATE POLICY "game_invites_select_participants"
ON public.game_invites FOR SELECT TO authenticated
USING (sender_id = auth.uid() OR recipient_id = auth.uid());

REVOKE ALL ON public.game_invites FROM anon, authenticated;
GRANT SELECT ON public.game_invites TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_stale_game_invites()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.game_invites
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at <= now();
$$;

CREATE OR REPLACE FUNCTION public.send_game_invite(p_recipient_id uuid, p_mode text DEFAULT '1v1')
RETURNS public.game_invites
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_invite public.game_invites%ROWTYPE;
  v_sender_status text;
  v_sender_seen timestamptz;
  v_status text;
  v_last_seen timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_recipient_id = auth.uid() THEN RAISE EXCEPTION 'Cannot invite yourself'; END IF;
  IF p_mode <> '1v1' THEN RAISE EXCEPTION 'Unsupported game mode'; END IF;
  IF NOT public.are_friends(auth.uid(), p_recipient_id) THEN
    RAISE EXCEPTION 'You can only invite confirmed friends';
  END IF;

  PERFORM public.expire_stale_game_invites();
  SELECT status, last_seen_at INTO v_sender_status, v_sender_seen
  FROM public.user_presence WHERE user_id = auth.uid();
  IF v_sender_status IS DISTINCT FROM 'online_available'
     OR v_sender_seen IS NULL OR v_sender_seen < now() - interval '35 seconds' THEN
    RAISE EXCEPTION 'You are not available to start a game';
  END IF;
  SELECT status, last_seen_at INTO v_status, v_last_seen
  FROM public.user_presence WHERE user_id = p_recipient_id;
  IF v_status IS DISTINCT FROM 'online_available'
     OR v_last_seen IS NULL OR v_last_seen < now() - interval '35 seconds' THEN
    RAISE EXCEPTION 'Player is not available';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.game_invites
    WHERE status = 'pending'
      AND LEAST(sender_id, recipient_id) = LEAST(auth.uid(), p_recipient_id)
      AND GREATEST(sender_id, recipient_id) = GREATEST(auth.uid(), p_recipient_id)
  ) THEN RAISE EXCEPTION 'An invitation is already pending'; END IF;

  INSERT INTO public.game_invites(sender_id, recipient_id, mode)
  VALUES (auth.uid(), p_recipient_id, p_mode)
  RETURNING * INTO v_invite;
  RETURN v_invite;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_game_invite(p_invite_id uuid)
RETURNS public.game_invites
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_invite public.game_invites%ROWTYPE;
BEGIN
  UPDATE public.game_invites
  SET status = 'cancelled', responded_at = now(), updated_at = now()
  WHERE id = p_invite_id AND sender_id = auth.uid() AND status = 'pending'
  RETURNING * INTO v_invite;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending invitation not found'; END IF;
  RETURN v_invite;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_game_invites()
RETURNS TABLE(
  id uuid, sender_id uuid, recipient_id uuid, mode text, status text,
  room_id uuid, created_at timestamptz, expires_at timestamptz,
  sender_username text, sender_player_id text, sender_avatar_id text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.expire_stale_game_invites();
  RETURN QUERY
  SELECT i.id, i.sender_id, i.recipient_id, i.mode, i.status, i.room_id,
         i.created_at, i.expires_at, p.username, p.player_id, p.avatar_id
  FROM public.game_invites i
  JOIN public.profiles p ON p.id = i.sender_id
  WHERE i.recipient_id = auth.uid() AND i.status = 'pending' AND i.expires_at > now()
  ORDER BY i.created_at ASC;
END;
$$;

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
  VALUES
    (v_room.id, v_invite.sender_id, public.next_one_vs_one_move_sequence(v_room.id), 'room_created', jsonb_build_object('game_invite_id', v_invite.id));

  INSERT INTO public.one_vs_one_moves(room_id, player_id, sequence, action, payload)
  VALUES
    (v_room.id, v_invite.recipient_id, public.next_one_vs_one_move_sequence(v_room.id), 'room_joined', jsonb_build_object('game_invite_id', v_invite.id));

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

REVOKE ALL ON FUNCTION public.update_my_presence(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_game_invites() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_game_invite(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.respond_game_invite(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_game_invite(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_pending_game_invites() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_my_presence(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_game_invite(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_game_invite(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_game_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_game_invites() TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_invites;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
