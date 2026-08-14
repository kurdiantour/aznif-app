-- Enable Supabase Realtime for the friendships table.
--
-- FriendsPanel subscribes to INSERT/UPDATE/DELETE events on public.friendships
-- so friendship changes (especially accepted friend requests) are reflected
-- immediately in the Friends List without requiring a manual refresh.
--
-- The duplicate_object handler makes this migration safe if friendships
-- has already been added to the supabase_realtime publication manually
-- or by another environment.

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.friendships;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END;
$$;