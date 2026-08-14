-- Enable Supabase Realtime for Domino 1v1 gameplay updates.
-- Required for immediate opponent board and turn updates.

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.one_vs_one_rooms;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.one_vs_one_moves;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END;
$$;