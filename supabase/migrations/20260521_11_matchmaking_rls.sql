-- Migration: Row Level Security for matchmaking_queue
-- Ensures users can only view and manage their own matchmaking entries

ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;

-- Users can view their own queue entries
CREATE POLICY "matchmaking_queue_select_own"
ON public.matchmaking_queue
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own queue entries (controlled by RPC in practice)
CREATE POLICY "matchmaking_queue_insert_own"
ON public.matchmaking_queue
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can update their own queue entries (controlled by RPC in practice)
CREATE POLICY "matchmaking_queue_update_own"
ON public.matchmaking_queue
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Users can delete their own queue entries (controlled by RPC in practice)
CREATE POLICY "matchmaking_queue_delete_own"
ON public.matchmaking_queue
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
