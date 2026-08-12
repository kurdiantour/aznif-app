-- okey_room writes the shared Party follow state after both teammates receive
-- the same Okey room. Limit service_role to the exact flow columns it needs.

GRANT UPDATE (
  flow_status,
  current_game,
  current_room_id,
  current_mode,
  current_currency,
  current_entry_fee,
  current_table_id,
  command_version,
  updated_at
) ON TABLE public.domino_parties TO service_role;

-- PostgREST needs SELECT to resolve the filtered PATCH target. The Edge
-- Function already runs as service_role and Party RLS remains unchanged for
-- every client role.
GRANT SELECT ON TABLE public.domino_parties TO service_role;

NOTIFY pgrst, 'reload schema';

