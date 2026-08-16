-- =========================================================
-- Domino Fun 1v1 Manual Leave
--
-- Manual Leave:
--   -25 Points exactly once
--   no final -15
--   no +35 Points
--   no Gem reward
--   no Coin prize
--
-- Bot / round continuation logic is NOT changed.
-- =========================================================


-- 1) Apply the -25 manual-leave penalty exactly once.

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
  v_settlement_id uuid;
  v_points_before integer;
  v_points_after integer;
BEGIN

  SELECT *
  INTO v_room
  FROM public.one_vs_one_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '1v1 room not found';
  END IF;

  -- Only Fun.
  -- Do not touch Aznif.
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

  -- Already settled = do nothing.
  SELECT r.id
  INTO v_settlement_id
  FROM public.match_reward_records r
  WHERE r.room_id = p_room_id
    AND r.mode = '1v1'
    AND r.user_id = p_user_id;

  IF v_settlement_id IS NOT NULL THEN
    RETURN v_settlement_id;
  END IF;

  SELECT COALESCE(points, 0)
  INTO v_points_before
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_initialized';
  END IF;

  v_points_after :=
    GREATEST(0, v_points_before - 25);

  INSERT INTO public.match_reward_records (
    room_id,
    mode,
    user_id,
    team_id,
    points,
    gold,
    tier,
    source,
    metadata
  )
  VALUES (
    p_room_id,
    '1v1',
    p_user_id,
    v_player.team_id,
    0,
    0,
    'manual_forfeit',
    'manual_leave_settlement',
    jsonb_build_object(
      'result', 'forfeit',
      'points_requested_delta', -25,
      'points_applied_delta',
        v_points_after - v_points_before,
      'points_before', v_points_before,
      'points_after', v_points_after
    )
  )
  ON CONFLICT (room_id, mode, user_id)
  DO NOTHING
  RETURNING id
  INTO v_settlement_id;

  IF v_settlement_id IS NULL THEN
    SELECT r.id
    INTO v_settlement_id
    FROM public.match_reward_records r
    WHERE r.room_id = p_room_id
      AND r.mode = '1v1'
      AND r.user_id = p_user_id;

    RETURN v_settlement_id;
  END IF;

  UPDATE public.profiles
  SET
    points = v_points_after,
    games_played = COALESCE(games_played, 0) + 1,
    games_lost = COALESCE(games_lost, 0) + 1
  WHERE id = p_user_id;

  RETURN v_settlement_id;
END;
$$;


REVOKE ALL
ON FUNCTION public.settle_free_one_vs_one_manual_forfeit(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.settle_free_one_vs_one_manual_forfeit(uuid, uuid)
TO service_role;



-- 2) When 1v1 manual_leave_takeover is recorded,
-- immediately apply the -25 Fun penalty.

CREATE OR REPLACE FUNCTION public.handle_one_vs_one_manual_leave_penalty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

  IF NEW.action = 'manual_leave_takeover'
     AND NEW.player_id IS NOT NULL
  THEN
    PERFORM public.settle_free_one_vs_one_manual_forfeit(
      NEW.room_id,
      NEW.player_id
    );
  END IF;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
  one_vs_one_manual_leave_penalty
ON public.one_vs_one_moves;

CREATE TRIGGER one_vs_one_manual_leave_penalty
AFTER INSERT
ON public.one_vs_one_moves
FOR EACH ROW
WHEN (NEW.action = 'manual_leave_takeover')
EXECUTE FUNCTION public.handle_one_vs_one_manual_leave_penalty();



-- 3) Prevent final Fun settlement from applying -15 / +35 / Gem
-- to a 1v1 player who manually left.

CREATE OR REPLACE FUNCTION public.block_one_vs_one_manual_leave_reward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

  IF NEW.mode = '1v1'
     AND EXISTS (
       SELECT 1
       FROM public.one_vs_one_moves m
       WHERE m.room_id = NEW.room_id
         AND m.player_id = NEW.user_id
         AND m.action = 'manual_leave_takeover'
     )
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
  block_one_vs_one_manual_leave_reward
ON public.domino_fun_match_rewards;

CREATE TRIGGER block_one_vs_one_manual_leave_reward
BEFORE INSERT
ON public.domino_fun_match_rewards
FOR EACH ROW
WHEN (NEW.mode = '1v1')
EXECUTE FUNCTION public.block_one_vs_one_manual_leave_reward();


NOTIFY pgrst, 'reload schema';