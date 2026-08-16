-- ============================================================
-- Domino 1v1: Consecutive Turn Timeout Strike → Bot Takeover
-- ============================================================
-- After 2 consecutive turn timeouts the NEXT time that player's
-- turn starts, bot_takeover fires immediately before the 20-second
-- timer can begin (enforced server-side, reflected to client via
-- Realtime one_vs_one_players update).
--
-- Heartbeat 30 s → 60 s  (applied in hooks/useOneVsOneGame.ts)
-- Grace period 60 s → 120 s (applied in process_bot_turns call)
-- ============================================================

-- 1. Strike counter column (idempotent)
ALTER TABLE public.one_vs_one_players
  ADD COLUMN IF NOT EXISTS consecutive_timeout_strikes INTEGER NOT NULL DEFAULT 0;

-- 2. apply_one_vs_one_timeout_strike_takeover
--    Sets the player to bot-controlled, same flag set as a disconnect
--    takeover so that resolve_one_vs_one_round_leave_forfeits handles
--    match settlement at round end.
CREATE OR REPLACE FUNCTION public.apply_one_vs_one_timeout_strike_takeover(
  p_room_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Idempotent: skip if already taken over.
  UPDATE public.one_vs_one_players
  SET
    bot_takeover = true,
    connected    = false,
    abandoned    = false,
    updated_at   = now()
  WHERE room_id      = p_room_id
    AND user_id      = p_user_id
    AND bot_takeover = false;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_one_vs_one_timeout_strike_takeover(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_one_vs_one_timeout_strike_takeover(uuid, uuid)
  TO service_role;

-- 3. process_one_vs_one_turn_strikes
--    Called by every edge function (move / pass / draw) after a
--    successful commit_multiplayer_action.
--
--    p_acting_user_id : player who just acted
--    p_next_user_id   : player who now holds the turn
--                       (may equal p_acting_user_id for in-draw-phase actions)
--    p_increment_acting: true  → timed-out pass → increment acting player's strikes
--                        false → any human action → reset acting player's strikes
--
--    Returns true if a takeover was triggered for p_next_user_id.
CREATE OR REPLACE FUNCTION public.process_one_vs_one_turn_strikes(
  p_room_id          uuid,
  p_acting_user_id   uuid,
  p_next_user_id     uuid,
  p_increment_acting boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next_strikes integer := 0;
BEGIN
  -- Update acting player's strike counter atomically.
  IF p_increment_acting THEN
    UPDATE public.one_vs_one_players
    SET consecutive_timeout_strikes = consecutive_timeout_strikes + 1,
        updated_at = now()
    WHERE room_id = p_room_id
      AND user_id = p_acting_user_id;
  ELSE
    UPDATE public.one_vs_one_players
    SET consecutive_timeout_strikes = 0,
        updated_at = now()
    WHERE room_id = p_room_id
      AND user_id = p_acting_user_id;
  END IF;

  -- Only check the next player when the turn actually changes to a
  -- different player.
  IF p_next_user_id IS NULL OR p_next_user_id = p_acting_user_id THEN
    RETURN false;
  END IF;

  SELECT consecutive_timeout_strikes
  INTO v_next_strikes
  FROM public.one_vs_one_players
  WHERE room_id = p_room_id
    AND user_id = p_next_user_id;

  IF COALESCE(v_next_strikes, 0) >= 2 THEN
    PERFORM public.apply_one_vs_one_timeout_strike_takeover(p_room_id, p_next_user_id);
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.process_one_vs_one_turn_strikes(uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_one_vs_one_turn_strikes(uuid, uuid, uuid, boolean)
  TO service_role;

NOTIFY pgrst, 'reload schema';
