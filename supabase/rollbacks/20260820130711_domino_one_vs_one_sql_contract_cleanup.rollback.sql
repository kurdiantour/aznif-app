-- Reverses only the metadata/index cleanup introduced by the matching migration.

CREATE INDEX IF NOT EXISTS idx_one_vs_one_moves_room_id_sequence
  ON public.one_vs_one_moves(room_id, sequence);

ALTER POLICY one_vs_one_matchmaking_select_own
  ON public.one_vs_one_matchmaking_queue
  USING (user_id = auth.uid());

ALTER FUNCTION public.set_one_vs_one_updated_at() RESET search_path;
ALTER FUNCTION public.set_one_vs_one_private_states_updated_at() RESET search_path;
ALTER FUNCTION public.set_one_vs_one_matchmaking_updated_at() RESET search_path;
ALTER FUNCTION public.generate_one_vs_one_room_code() RESET search_path;
ALTER FUNCTION public.resolve_one_vs_one_seat_assignment(integer) RESET search_path;
ALTER FUNCTION public.get_one_vs_one_matchmaking_status() RESET search_path;
ALTER FUNCTION public.is_one_vs_one_room_member(uuid) RESET search_path;
COMMENT ON FUNCTION public.get_one_vs_one_snapshot(uuid) IS NULL;
COMMENT ON FUNCTION public.get_one_vs_one_snapshot_before_free_economy(uuid) IS NULL;
COMMENT ON FUNCTION public.get_one_vs_one_snapshot_internal_20260613(uuid) IS NULL;
COMMENT ON FUNCTION public.find_domino_match(text, text, numeric) IS NULL;
COMMENT ON FUNCTION public.start_one_vs_one_game(uuid) IS NULL;
COMMENT ON FUNCTION public.leave_one_vs_one_match(uuid) IS NULL;
COMMENT ON FUNCTION public.process_one_vs_one_turn_strikes(uuid, uuid, uuid, boolean) IS NULL;
COMMENT ON FUNCTION public.apply_one_vs_one_timeout_strike_takeover(uuid, uuid) IS NULL;
COMMENT ON FUNCTION public.resolve_one_vs_one_terminal_round(uuid) IS NULL;
COMMENT ON FUNCTION public.resolve_one_vs_one_round_leave_forfeits(uuid) IS NULL;
COMMENT ON FUNCTION public.domino_settle_match(text, uuid) IS NULL;
