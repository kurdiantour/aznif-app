create or replace function public.okey_get_system_authoritative_bundle(
  p_match_id uuid
)
returns table (
  version bigint,
  status text,
  turn_deadline_at timestamptz,
  player_index smallint,
  state jsonb,
  command_applied boolean
)
language plpgsql security definer
set search_path = pg_catalog, public, okey
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_match_id is null then
    raise exception 'match_id_required' using errcode = '22023';
  end if;

  return query
  select
    match.version,
    match.status,
    match.turn_deadline_at,
    0::smallint as player_index,
    private_state.state,
    false as command_applied
  from okey.matches match
  join okey.match_private_states private_state on private_state.match_id = match.id
  where match.id = p_match_id;
end;
$$;

revoke all on function public.okey_get_system_authoritative_bundle(uuid) from public, anon, authenticated;
grant execute on function public.okey_get_system_authoritative_bundle(uuid) to service_role;
