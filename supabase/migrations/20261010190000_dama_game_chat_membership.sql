CREATE OR REPLACE FUNCTION public.is_game_room_member(
  p_game_type text,
  p_match_id uuid,
  p_user_id uuid DEFAULT auth.uid(),
  p_mode text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, okey, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN p_game_type = 'domino' AND p_mode = '1v1' THEN EXISTS (
      SELECT 1
      FROM public.one_vs_one_players
      WHERE room_id = p_match_id
        AND user_id = p_user_id
        AND left_at IS NULL
    )
    WHEN p_game_type = 'domino' AND p_mode = '2v2' THEN EXISTS (
      SELECT 1
      FROM public.two_vs_two_players
      WHERE room_id = p_match_id
        AND user_id = p_user_id
        AND left_at IS NULL
    )
    WHEN p_game_type = 'okey' THEN EXISTS (
      SELECT 1
      FROM okey.match_seats
      WHERE match_id = p_match_id
        AND user_id = p_user_id
        AND membership_released_at IS NULL
    )
    WHEN p_game_type = 'dame' THEN EXISTS (
      SELECT 1
      FROM public.dama_players
      WHERE room_id = p_match_id
        AND user_id = p_user_id
    )
    ELSE false
  END;
$$;
