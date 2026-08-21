-- A timeout strike belongs to the player whose turn just expired. The legacy
-- implementation incremented that row but checked p_next_user_id for the
-- takeover threshold. That delayed takeover until the timed-out player got
-- another turn. If the opponent had already been taken over by a bot, no
-- human post-commit lifecycle remained to perform that later check, leaving
-- the last human seat and the room active forever.
--
-- Apply the second-strike takeover immediately to p_acting_user_id in the
-- same server-side lifecycle call. Keep p_next_user_id in the signature for
-- compatibility with deployed Edge Functions.
CREATE OR REPLACE FUNCTION public.process_one_vs_one_turn_strikes(
  p_room_id uuid,
  p_acting_user_id uuid,
  p_next_user_id uuid,
  p_increment_acting boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_acting_strikes integer := 0;
BEGIN
  IF p_increment_acting THEN
    UPDATE public.one_vs_one_players
    SET consecutive_timeout_strikes = consecutive_timeout_strikes + 1,
        updated_at = now()
    WHERE room_id = p_room_id
      AND user_id = p_acting_user_id
      AND bot_takeover = false
    RETURNING consecutive_timeout_strikes
    INTO v_acting_strikes;

    IF COALESCE(v_acting_strikes, 0) >= 2 THEN
      PERFORM public.apply_one_vs_one_timeout_strike_takeover(
        p_room_id,
        p_acting_user_id
      );
      RETURN true;
    END IF;
  ELSE
    UPDATE public.one_vs_one_players
    SET consecutive_timeout_strikes = 0,
        updated_at = now()
    WHERE room_id = p_room_id
      AND user_id = p_acting_user_id
      AND bot_takeover = false;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL
ON FUNCTION public.process_one_vs_one_turn_strikes(uuid, uuid, uuid, boolean)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.process_one_vs_one_turn_strikes(uuid, uuid, uuid, boolean)
TO service_role;

COMMENT ON FUNCTION public.process_one_vs_one_turn_strikes(uuid, uuid, uuid, boolean) IS
  'CANONICAL service-only 1v1 strike transition; immediately takes over the acting human on their second consecutive timeout.';

NOTIFY pgrst, 'reload schema';