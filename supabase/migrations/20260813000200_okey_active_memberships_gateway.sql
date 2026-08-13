create or replace function public.get_active_okey_memberships(
  p_user_id uuid
)
returns table (
  match_id uuid,
  player_index integer,
  status text
)
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  return query
  select
    seat.match_id,
    seat.player_index::integer,
    match.status::text
  from okey.match_seats as seat
  join okey.matches as match
    on match.id = seat.match_id
  left join okey.match_private_states as private_state
    on private_state.match_id = match.id
  where seat.user_id = p_user_id
    and match.status in ('waiting', 'playing')
    and not (
      coalesce(private_state.state->'manualLeftPlayerIds', '[]'::jsonb)
      ? p_user_id::text
    );
end;
$$;

revoke all on function public.get_active_okey_memberships(uuid)
  from public, anon, authenticated;

grant execute on function public.get_active_okey_memberships(uuid)
  to service_role;