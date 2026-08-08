CREATE TABLE IF NOT EXISTS public.game_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('1v1', '2v2')),
  room_id uuid NOT NULL,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name text NOT NULL,
  sender_avatar_id text,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_game_chat_messages_room_mode_created
ON public.game_chat_messages(mode, room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_game_chat_messages_sender
ON public.game_chat_messages(sender_user_id);
CREATE OR REPLACE FUNCTION public.is_game_room_member(
  p_mode text,
  p_room_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN p_mode = '1v1' THEN EXISTS (
      SELECT 1
      FROM public.one_vs_one_players
      WHERE room_id = p_room_id
        AND user_id = p_user_id
    )
    WHEN p_mode = '2v2' THEN EXISTS (
      SELECT 1
      FROM public.two_vs_two_players
      WHERE room_id = p_room_id
        AND user_id = p_user_id
    )
    ELSE false
  END;
$$;
CREATE OR REPLACE FUNCTION public.send_game_chat_message(
  p_mode text,
  p_room_id uuid,
  p_body text
)
RETURNS public.game_chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_body text := btrim(COALESCE(p_body, ''));
  v_profile public.profiles%ROWTYPE;
  v_message public.game_chat_messages%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_mode NOT IN ('1v1', '2v2') THEN
    RAISE EXCEPTION 'Invalid game chat mode';
  END IF;

  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'room_id is required';
  END IF;

  IF char_length(v_body) = 0 THEN
    RAISE EXCEPTION 'Message is required';
  END IF;

  IF char_length(v_body) > 500 THEN
    RAISE EXCEPTION 'Message is too long';
  END IF;

  IF NOT public.is_game_room_member(p_mode, p_room_id, v_user_id) THEN
    RAISE EXCEPTION 'You are not a member of this room';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  INSERT INTO public.game_chat_messages (
    mode,
    room_id,
    sender_user_id,
    sender_name,
    sender_avatar_id,
    body
  ) VALUES (
    p_mode,
    p_room_id,
    v_user_id,
    COALESCE(NULLIF(v_profile.username, ''), 'Player'),
    v_profile.avatar_id,
    v_body
  )
  RETURNING * INTO v_message;

  RETURN v_message;
END;
$$;
ALTER TABLE public.game_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "game_chat_messages_select_room_members"
ON public.game_chat_messages;
CREATE POLICY "game_chat_messages_select_room_members"
ON public.game_chat_messages
FOR SELECT
TO authenticated
USING (public.is_game_room_member(mode, room_id));
DROP POLICY IF EXISTS "game_chat_messages_insert_rpc_only"
ON public.game_chat_messages;
CREATE POLICY "game_chat_messages_insert_rpc_only"
ON public.game_chat_messages
FOR INSERT
TO authenticated
WITH CHECK (false);
DROP POLICY IF EXISTS "game_chat_messages_update_denied"
ON public.game_chat_messages;
CREATE POLICY "game_chat_messages_update_denied"
ON public.game_chat_messages
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);
DROP POLICY IF EXISTS "game_chat_messages_delete_denied"
ON public.game_chat_messages;
CREATE POLICY "game_chat_messages_delete_denied"
ON public.game_chat_messages
FOR DELETE
TO authenticated
USING (false);
GRANT SELECT ON public.game_chat_messages TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.game_chat_messages FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_game_room_member(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_game_chat_message(text, uuid, text) TO authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'game_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_chat_messages;
  END IF;
END $$;
