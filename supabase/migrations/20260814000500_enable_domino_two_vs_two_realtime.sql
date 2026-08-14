-- Enable Supabase Realtime and required server-side privileges
-- for Domino 2v2 gameplay.
--
-- Realtime is required so room/player/move updates reach clients
-- immediately instead of relying on fallback polling.
--
-- service_role privileges are required by server-side Edge Functions
-- such as submit_two_vs_two and process_bot_turns.

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.two_vs_two_rooms;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.two_vs_two_players;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.two_vs_two_moves;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE
  public.two_vs_two_rooms,
  public.two_vs_two_players,
  public.two_vs_two_private_states,
  public.two_vs_two_moves
TO service_role;