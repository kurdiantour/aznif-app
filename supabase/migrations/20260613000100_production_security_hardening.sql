-- Close client-authority gaps discovered during the production audit.

CREATE OR REPLACE FUNCTION public.mark_one_vs_one_player_disconnected(
  p_room_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_user_id IS NOT NULL AND p_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Cannot disconnect another player';
  END IF;

  UPDATE public.one_vs_one_players
  SET connected = false,
      bot_takeover = false,
      takeover_started_at = NULL,
      takeover_expires_at = now() + interval '30 seconds',
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND abandoned = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active player in this 1v1 room';
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.mark_two_vs_two_player_disconnected(
  p_room_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_user_id IS NOT NULL AND p_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Cannot disconnect another player';
  END IF;

  UPDATE public.two_vs_two_players
  SET connected = false,
      bot_takeover = false,
      takeover_started_at = NULL,
      takeover_expires_at = now() + interval '30 seconds',
      updated_at = now()
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND abandoned = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active player in this 2v2 room';
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'room_id', p_room_id);
END;
$$;
-- Offline practice results cannot be independently verified by the server.
-- Keep historical claims readable, but disable new public progression awards.
REVOKE ALL ON FUNCTION public.award_ai_practice_win(text)
FROM PUBLIC, anon, authenticated;
-- Match rewards are settled by service-role Edge Functions from finished rooms.
REVOKE ALL ON FUNCTION public.settle_match_rewards(text, uuid)
FROM PUBLIC, anon, authenticated;
-- Takeover scans are maintenance operations, never player-authorized actions.
REVOKE ALL ON FUNCTION public.process_one_vs_one_takeovers(int)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_two_vs_two_takeovers(int)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_one_vs_one_takeovers(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_two_vs_two_takeovers(int) TO service_role;
REVOKE ALL ON FUNCTION public.mark_one_vs_one_player_disconnected(uuid, uuid)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_two_vs_two_player_disconnected(uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_one_vs_one_player_disconnected(uuid, uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_two_vs_two_player_disconnected(uuid, uuid)
TO authenticated;
