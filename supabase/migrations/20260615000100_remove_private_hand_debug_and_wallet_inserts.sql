-- Remove client-visible private-hand diagnostics and direct wallet creation.

ALTER FUNCTION public.get_one_vs_one_snapshot(uuid)
RENAME TO get_one_vs_one_snapshot_internal_20260613;
REVOKE ALL ON FUNCTION public.get_one_vs_one_snapshot_internal_20260613(uuid)
FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_one_vs_one_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snapshot jsonb;
BEGIN
  v_snapshot := public.get_one_vs_one_snapshot_internal_20260613(p_room_id);

  RETURN v_snapshot
    - 'debugRpcVersion'
    - 'debugAuthUserId'
    - 'debugDbCurrentUser'
    - 'debugDbSessionUser'
    - 'debugPlayerIndex'
    - 'debugRoomStatus'
    - 'debugPrivateStateFound'
    - 'debugPrivateRoomId'
    - 'debugPrivateHandsRaw'
    - 'debugHandsLength'
    - 'debugSelectedHandLength'
    - 'debugOpeningDouble'
    - 'debugOpeningPlayerIndex'
    - 'debugOpeningTurnPlayerId'
    - 'debugCorrectedOpeningTurn';
END;
$$;
REVOKE ALL ON FUNCTION public.get_one_vs_one_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_one_vs_one_snapshot(uuid) TO authenticated;
DROP POLICY IF EXISTS "Users can insert own wallet" ON public.wallets;
REVOKE INSERT ON public.wallets FROM PUBLIC, anon, authenticated;
