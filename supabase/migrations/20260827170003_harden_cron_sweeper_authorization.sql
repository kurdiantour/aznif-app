create or replace function game_room_connection.sweep_expired_connections(p_limit integer default 100)
returns integer language plpgsql security definer
set search_path = pg_catalog, game_room_connection
as $$
declare r record; v_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  for r in
    select user_id, game_type, room_id, connection_id, generation
    from game_room_connection.connections
    where state = 'grace' and grace_deadline_at <= clock_timestamp()
    order by grace_deadline_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  loop
    perform game_room_connection.finish_disconnect(
      r.user_id, r.game_type, r.room_id, r.connection_id, r.generation
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
