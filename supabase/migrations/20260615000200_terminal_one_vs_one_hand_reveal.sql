-- Reveal completed-round hands to room members without exposing them in active play.

CREATE OR REPLACE FUNCTION public.get_one_vs_one_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snapshot jsonb;
  v_safe_snapshot jsonb;
  v_final_hands jsonb;
  v_round_finished boolean;
BEGIN
  -- The internal function performs authentication and room-membership checks.
  v_snapshot := public.get_one_vs_one_snapshot_internal_20260613(p_room_id);

  v_safe_snapshot := v_snapshot
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

  v_round_finished :=
    COALESCE(v_snapshot -> 'state' ->> 'roundWinnerPlayerId', '') <> ''
    OR COALESCE(v_snapshot -> 'state' ->> 'winningTeamId', '') <> ''
    OR COALESCE(v_snapshot ->> 'status', '') = 'finished';

  IF NOT v_round_finished THEN
    RETURN v_safe_snapshot - 'revealedFinalHands';
  END IF;

  SELECT hands INTO v_final_hands
  FROM public.one_vs_one_private_states
  WHERE room_id = p_room_id;

  RETURN v_safe_snapshot || jsonb_build_object(
    'revealedFinalHands', COALESCE(v_final_hands, '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_one_vs_one_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_one_vs_one_snapshot(uuid) TO authenticated;
