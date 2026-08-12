-- A game invite only forms a Domino party. Match mode is selected later when
-- the party leader starts 2v2 matchmaking, so invites must not carry 1v1/2v2.

DROP FUNCTION IF EXISTS public.send_game_invite(uuid, text);
DROP FUNCTION IF EXISTS public.get_pending_game_invites();

ALTER TABLE public.game_invites DROP COLUMN IF EXISTS mode;

CREATE OR REPLACE FUNCTION public.send_game_invite(p_recipient_id uuid)
RETURNS public.game_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite public.game_invites%ROWTYPE;
  v_status text;
  v_last_seen timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_recipient_id = auth.uid() THEN RAISE EXCEPTION 'Cannot invite yourself'; END IF;
  IF NOT public.are_friends(auth.uid(), p_recipient_id) THEN
    RAISE EXCEPTION 'You can only invite confirmed friends';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.domino_party_members
    WHERE user_id IN (auth.uid(), p_recipient_id)
  ) THEN
    RAISE EXCEPTION 'player_already_in_party';
  END IF;

  PERFORM public.expire_stale_game_invites();

  SELECT status, last_seen_at INTO v_status, v_last_seen
  FROM public.user_presence WHERE user_id = p_recipient_id;
  IF v_status IS DISTINCT FROM 'online_available'
     OR v_last_seen IS NULL
     OR v_last_seen < now() - interval '35 seconds' THEN
    RAISE EXCEPTION 'Player is not available';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.game_invites
    WHERE status = 'pending'
      AND LEAST(sender_id, recipient_id) = LEAST(auth.uid(), p_recipient_id)
      AND GREATEST(sender_id, recipient_id) = GREATEST(auth.uid(), p_recipient_id)
  ) THEN
    RAISE EXCEPTION 'An invitation is already pending';
  END IF;

  INSERT INTO public.game_invites(sender_id, recipient_id)
  VALUES (auth.uid(), p_recipient_id)
  RETURNING * INTO v_invite;
  RETURN v_invite;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_game_invites()
RETURNS TABLE(
  id uuid,
  sender_id uuid,
  recipient_id uuid,
  status text,
  room_id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  sender_username text,
  sender_player_id text,
  sender_avatar_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.expire_stale_game_invites();
  RETURN QUERY
  SELECT i.id, i.sender_id, i.recipient_id, i.status, i.room_id,
         i.created_at, i.expires_at, p.username, p.player_id, p.avatar_id
  FROM public.game_invites i
  JOIN public.profiles p ON p.id = i.sender_id
  WHERE i.recipient_id = auth.uid()
    AND i.status = 'pending'
    AND i.expires_at > now()
  ORDER BY i.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.send_game_invite(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_pending_game_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_game_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_game_invites() TO authenticated;
