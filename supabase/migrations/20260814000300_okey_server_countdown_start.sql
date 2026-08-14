-- Starting an Okey room after its countdown is a server lifecycle decision.
-- Clients request room status; four post-deadline heartbeats are not required.
create or replace function public.okey_confirm_server_countdown(p_match_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_deadline timestamptz;
  v_member_count integer;
  v_connected_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select countdown_deadline_at
  into v_deadline
  from okey.matches
  where id = p_match_id and status = 'waiting'
  for update;

  if not found or v_deadline is null or v_deadline > now() then
    return false;
  end if;

  select count(*), count(*) filter (where connected = true)
  into v_member_count, v_connected_count
  from okey.match_seats
  where match_id = p_match_id and membership_released_at is null;

  if v_member_count <> 4 or v_connected_count <> 4 then
    return false;
  end if;

  update okey.match_seats
  set last_seen_at = greatest(last_seen_at, v_deadline)
  where match_id = p_match_id
    and membership_released_at is null
    and connected = true;

  return true;
end;
$$;

revoke all on function public.okey_confirm_server_countdown(uuid)
from public, anon, authenticated;
grant execute on function public.okey_confirm_server_countdown(uuid)
to service_role;