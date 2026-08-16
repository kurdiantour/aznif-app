-- Fix Domino Fun manual-leave settlement so it no longer references the removed
-- public.match_reward_records table. This keeps manual-leave takeover atomic and
-- uses the current public.domino_fun_match_rewards table as the idempotency record.

DROP TRIGGER IF EXISTS block_one_vs_one_manual_leave_reward
ON public.domino_fun_match_rewards;

DROP FUNCTION IF EXISTS public.block_one_vs_one_manual_leave_reward();


CREATE OR REPLACE FUNCTION public.settle_free_one_vs_one_manual_forfeit(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.one_vs_one_rooms%ROWTYPE;
  v_player public.one_vs_one_players%ROWTYPE;
  v_inserted boolean := false;
BEGIN
  SELECT *
  INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  IF v_room.currency <> 'fun' THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_player
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND kind = 'human'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forfeiting human player not found';
  END IF;

  INSERT INTO public.domino_fun_match_rewards (
    mode,
    room_id,
    user_id,
    team_id,
    point_delta,
    gem_delta
  )
  VALUES (
    '1v1',
    p_room_id,
    p_user_id,
    v_player.team_id,
    -25,
    0
  )
  ON CONFLICT (mode, room_id, user_id) DO NOTHING;

  v_inserted := FOUND;

  IF v_inserted THEN
    UPDATE public.profiles
    SET
      points = GREATEST(0, COALESCE(points, 0) - 25),
      games_played = COALESCE(games_played, 0) + 1,
      games_lost = COALESCE(games_lost, 0) + 1,
      updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_not_initialized';
    END IF;
  END IF;

  RETURN p_room_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.settle_free_one_vs_one_manual_forfeit(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.settle_free_one_vs_one_manual_forfeit(uuid, uuid)
TO service_role;


CREATE OR REPLACE FUNCTION public.settle_free_two_vs_two_manual_forfeit(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.two_vs_two_rooms%ROWTYPE;
  v_player public.two_vs_two_players%ROWTYPE;
  v_inserted boolean := false;
BEGIN
  SELECT *
  INTO v_room
  FROM public.two_vs_two_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '2v2 room not found';
  END IF;

  IF v_room.status <> 'active' THEN
    RAISE EXCEPTION 'Manual forfeit requires an active 2v2 match';
  END IF;

  IF v_room.currency <> 'fun' THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_player
  FROM public.two_vs_two_players
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND kind = 'human'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forfeiting human player not found';
  END IF;

  INSERT INTO public.domino_fun_match_rewards (
    mode,
    room_id,
    user_id,
    team_id,
    point_delta,
    gem_delta
  )
  VALUES (
    '2v2',
    p_room_id,
    p_user_id,
    v_player.team_id,
    -25,
    0
  )
  ON CONFLICT (mode, room_id, user_id) DO NOTHING;

  v_inserted := FOUND;

  IF v_inserted THEN
    UPDATE public.profiles
    SET
      points = GREATEST(0, COALESCE(points, 0) - 25),
      games_played = COALESCE(games_played, 0) + 1,
      games_lost = COALESCE(games_lost, 0) + 1,
      updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_not_initialized';
    END IF;
  END IF;

  RETURN p_room_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.settle_free_two_vs_two_manual_forfeit(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.settle_free_two_vs_two_manual_forfeit(uuid, uuid)
TO service_role;

NOTIFY pgrst, 'reload schema';