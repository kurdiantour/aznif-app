-- Domino 1v1 SQL contract cleanup (behavior-preserving).
-- Historical migrations remain immutable. This migration documents the final
-- object ownership and removes only a proven duplicate index.

DO $$
DECLARE
  v_duplicate_matches boolean;
BEGIN
  IF to_regclass('public.idx_one_vs_one_moves_room_id_sequence') IS NOT NULL THEN
    IF to_regclass('public.one_vs_one_moves_room_id_sequence_key') IS NULL THEN
      RAISE EXCEPTION
        'Cannot remove idx_one_vs_one_moves_room_id_sequence: canonical unique index is missing';
    END IF;

    SELECT
      duplicate.indrelid = canonical.indrelid
      AND duplicate.indkey = canonical.indkey
      AND duplicate.indcollation = canonical.indcollation
      AND duplicate.indclass = canonical.indclass
      AND duplicate.indoption = canonical.indoption
      AND duplicate.indexprs IS NULL
      AND canonical.indexprs IS NULL
      AND duplicate.indpred IS NULL
      AND canonical.indpred IS NULL
    INTO v_duplicate_matches
    FROM pg_catalog.pg_index AS duplicate
    JOIN pg_catalog.pg_class AS duplicate_class
      ON duplicate_class.oid = duplicate.indexrelid
    JOIN pg_catalog.pg_namespace AS duplicate_namespace
      ON duplicate_namespace.oid = duplicate_class.relnamespace
    CROSS JOIN pg_catalog.pg_index AS canonical
    JOIN pg_catalog.pg_class AS canonical_class
      ON canonical_class.oid = canonical.indexrelid
    JOIN pg_catalog.pg_namespace AS canonical_namespace
      ON canonical_namespace.oid = canonical_class.relnamespace
    WHERE duplicate_namespace.nspname = 'public'
      AND duplicate_class.relname = 'idx_one_vs_one_moves_room_id_sequence'
      AND canonical_namespace.nspname = 'public'
      AND canonical_class.relname = 'one_vs_one_moves_room_id_sequence_key';

    IF v_duplicate_matches IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'Refusing to remove idx_one_vs_one_moves_room_id_sequence: definitions differ';
    END IF;

    DROP INDEX public.idx_one_vs_one_moves_room_id_sequence;
  END IF;
END;
$$;

-- Remove mutable search_path from the remaining 1v1 helpers without changing
-- their bodies or caller contracts.
ALTER FUNCTION public.set_one_vs_one_updated_at()
  SET search_path TO public, pg_temp;
ALTER FUNCTION public.set_one_vs_one_private_states_updated_at()
  SET search_path TO public, pg_temp;
ALTER FUNCTION public.set_one_vs_one_matchmaking_updated_at()
  SET search_path TO public, pg_temp;
ALTER FUNCTION public.generate_one_vs_one_room_code()
  SET search_path TO public, pg_temp;
ALTER FUNCTION public.resolve_one_vs_one_seat_assignment(integer)
  SET search_path TO public, pg_temp;
ALTER FUNCTION public.get_one_vs_one_matchmaking_status()
  SET search_path TO public, pg_temp;
ALTER FUNCTION public.is_one_vs_one_room_member(uuid)
  SET search_path TO public, pg_temp;

-- Same predicate, planned once per statement instead of once per row.
ALTER POLICY one_vs_one_matchmaking_select_own
  ON public.one_vs_one_matchmaking_queue
  USING (user_id = (SELECT auth.uid()));
COMMENT ON FUNCTION public.get_one_vs_one_snapshot(uuid) IS
  'CANONICAL Domino 1v1 authenticated snapshot RPC. Internal compatibility stages remain implementation details.';
COMMENT ON FUNCTION public.get_one_vs_one_snapshot_before_free_economy(uuid) IS
  'ACTIVE INTERNAL COMPATIBILITY stage used by get_one_vs_one_snapshot; do not call directly or drop until the canonical snapshot is flattened.';
COMMENT ON FUNCTION public.get_one_vs_one_snapshot_internal_20260613(uuid) IS
  'ACTIVE INTERNAL COMPATIBILITY stage used by the canonical snapshot chain; historical name does not mean unused.';

COMMENT ON FUNCTION public.find_domino_match(text, text, numeric) IS
  'CANONICAL shared Domino matchmaking RPC for 1v1 and 2v2.';
COMMENT ON FUNCTION public.find_one_vs_one_opponent() IS
  'LEGACY 1v1 matchmaking compatibility RPC; retained for older clients. New clients use find_domino_match.';
COMMENT ON FUNCTION public.find_one_vs_one_bet_match(numeric) IS
  'LEGACY 1v1 paid-match compatibility RPC; retained for older clients. New clients use find_domino_match.';

COMMENT ON FUNCTION public.start_one_vs_one_game(uuid) IS
  'CANONICAL Domino 1v1 start/next-round RPC.';
COMMENT ON FUNCTION public.leave_one_vs_one_match(uuid) IS
  'CANONICAL explicit Manual Leave RPC. Disconnect and heartbeat must not create terminal effects.';
COMMENT ON FUNCTION public.cancel_one_vs_one_room(uuid) IS
  'LEGACY cancellation compatibility RPC; retained for older clients. Active gameplay leave uses leave_one_vs_one_match.';

COMMENT ON FUNCTION public.process_one_vs_one_turn_strikes(uuid, uuid, uuid, boolean) IS
  'CANONICAL service-only consecutive-timeout policy entrypoint.';
COMMENT ON FUNCTION public.apply_one_vs_one_timeout_strike_takeover(uuid, uuid) IS
  'CANONICAL service-only atomic second-timeout takeover transition.';
COMMENT ON FUNCTION public.resolve_one_vs_one_terminal_round(uuid) IS
  'CANONICAL service-only Domino 1v1 terminal-round resolver shared by Manual Leave and timeout_takeover.';
COMMENT ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid) IS
  'ACTIVE COMPATIBILITY adapter to resolve_one_vs_one_terminal_round; retained for current workers during staged migration.';
COMMENT ON FUNCTION public.domino_settle_match(text, uuid) IS
  'CANONICAL shared Domino economy settlement for 1v1 and 2v2; service-role only.';
