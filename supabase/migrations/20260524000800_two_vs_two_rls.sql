CREATE OR REPLACE FUNCTION public.is_two_vs_two_room_member(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.two_vs_two_players
    WHERE room_id = p_room_id
      AND user_id = auth.uid()
  );
$$;
ALTER TABLE public.two_vs_two_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.two_vs_two_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.two_vs_two_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.two_vs_two_private_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.two_vs_two_matchmaking_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "two_vs_two_rooms_select_members"
ON public.two_vs_two_rooms;
CREATE POLICY "two_vs_two_rooms_select_members"
ON public.two_vs_two_rooms
FOR SELECT
TO authenticated
USING (public.is_two_vs_two_room_member(id));
DROP POLICY IF EXISTS "two_vs_two_rooms_insert_rpc_only"
ON public.two_vs_two_rooms;
CREATE POLICY "two_vs_two_rooms_insert_rpc_only"
ON public.two_vs_two_rooms
FOR INSERT
TO authenticated
WITH CHECK (false);
DROP POLICY IF EXISTS "two_vs_two_rooms_update_rpc_only"
ON public.two_vs_two_rooms;
CREATE POLICY "two_vs_two_rooms_update_rpc_only"
ON public.two_vs_two_rooms
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);
DROP POLICY IF EXISTS "two_vs_two_players_select_members"
ON public.two_vs_two_players;
CREATE POLICY "two_vs_two_players_select_members"
ON public.two_vs_two_players
FOR SELECT
TO authenticated
USING (public.is_two_vs_two_room_member(room_id));
DROP POLICY IF EXISTS "two_vs_two_players_insert_rpc_only"
ON public.two_vs_two_players;
CREATE POLICY "two_vs_two_players_insert_rpc_only"
ON public.two_vs_two_players
FOR INSERT
TO authenticated
WITH CHECK (false);
DROP POLICY IF EXISTS "two_vs_two_players_update_rpc_only"
ON public.two_vs_two_players;
CREATE POLICY "two_vs_two_players_update_rpc_only"
ON public.two_vs_two_players
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);
DROP POLICY IF EXISTS "two_vs_two_moves_select_members"
ON public.two_vs_two_moves;
CREATE POLICY "two_vs_two_moves_select_members"
ON public.two_vs_two_moves
FOR SELECT
TO authenticated
USING (public.is_two_vs_two_room_member(room_id));
DROP POLICY IF EXISTS "two_vs_two_moves_insert_denied"
ON public.two_vs_two_moves;
CREATE POLICY "two_vs_two_moves_insert_denied"
ON public.two_vs_two_moves
FOR INSERT
TO authenticated
WITH CHECK (false);
DROP POLICY IF EXISTS "two_vs_two_private_no_client_select"
ON public.two_vs_two_private_states;
CREATE POLICY "two_vs_two_private_no_client_select"
ON public.two_vs_two_private_states
FOR SELECT
TO authenticated
USING (false);
DROP POLICY IF EXISTS "two_vs_two_queue_select_own"
ON public.two_vs_two_matchmaking_queue;
CREATE POLICY "two_vs_two_queue_select_own"
ON public.two_vs_two_matchmaking_queue
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
GRANT SELECT ON public.two_vs_two_rooms TO authenticated;
GRANT SELECT ON public.two_vs_two_players TO authenticated;
GRANT SELECT ON public.two_vs_two_moves TO authenticated;
GRANT SELECT ON public.two_vs_two_matchmaking_queue TO authenticated;
REVOKE INSERT, UPDATE, DELETE
ON public.two_vs_two_rooms
FROM authenticated;
REVOKE INSERT, UPDATE, DELETE
ON public.two_vs_two_players
FROM authenticated;
REVOKE INSERT, UPDATE, DELETE
ON public.two_vs_two_moves
FROM authenticated;
REVOKE INSERT, UPDATE, DELETE
ON public.two_vs_two_matchmaking_queue
FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_two_vs_two_opponent()
TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_two_vs_two_matchmaking_status()
TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_two_vs_two_matchmaking(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_two_vs_two_room(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_two_vs_two_game(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_two_vs_two_room_member(uuid)
TO authenticated;
