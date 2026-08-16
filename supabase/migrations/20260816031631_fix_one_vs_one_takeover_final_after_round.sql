CREATE OR REPLACE FUNCTION public.finalize_one_vs_one_takeover_after_round()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'active'
     AND NULLIF(NEW.state ->> 'roundWinnerPlayerId', '') IS NOT NULL
     AND (
       OLD.state IS DISTINCT FROM NEW.state
       OR NULLIF(OLD.state ->> 'roundWinnerPlayerId', '') IS NULL
     )
     AND EXISTS (
       SELECT 1
       FROM public.one_vs_one_players p
       WHERE p.room_id = NEW.id
         AND p.bot_takeover = true
         AND p.connected = false
         AND p.abandoned = false
     )
  THEN
    PERFORM public.resolve_one_vs_one_round_leave_forfeits(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.finalize_one_vs_one_takeover_after_round()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_finalize_one_vs_one_takeover_after_round
ON public.one_vs_one_rooms;

CREATE TRIGGER trg_finalize_one_vs_one_takeover_after_round
AFTER UPDATE OF state
ON public.one_vs_one_rooms
FOR EACH ROW
EXECUTE FUNCTION public.finalize_one_vs_one_takeover_after_round();