-- Close the remaining connection-lifecycle gaps while keeping the internal
-- schema outside PostgREST's exposed-schema list.

create extension if not exists pg_cron with schema pg_catalog;

-- Cron runs as a database role, while API callers arrive with service_role JWT.
create or replace function game_room_connection.sweep_expired_connections(p_limit integer default 100)
returns integer language plpgsql security definer
set search_path = pg_catalog, game_room_connection
as $$
declare r record; v_count integer := 0;
begin
  if auth.role() <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
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

-- Exactly one active/grace gameplay session is permitted per membership.
update game_room_connection.connections c
set state = 'disconnected', grace_deadline_at = null,
    disconnected_at = coalesce(disconnected_at, clock_timestamp()), updated_at = clock_timestamp()
where c.state in ('active', 'grace') and exists (
  select 1 from game_room_connection.connections newer
  where newer.game_type = c.game_type and newer.room_id = c.room_id
    and newer.user_id = c.user_id and newer.state in ('active', 'grace')
    and (newer.generation, newer.connection_id) > (c.generation, c.connection_id)
);
create unique index game_room_connections_one_live_session_idx
on game_room_connection.connections(game_type, room_id, user_id)
where state in ('active', 'grace');

-- Allocation creates a durable provisional grace lease. It covers app death
-- between authoritative seat allocation and the first join_room message.
create function game_room_connection.provision_membership(
  p_game text, p_room uuid, p_user uuid, p_phase text default 'waiting'
) returns void language plpgsql security definer
set search_path = pg_catalog, game_room_connection
as $$
declare v_connection uuid := extensions.gen_random_uuid(); v_generation bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_game || ':' || p_room::text || ':' || p_user::text, 0));
  v_generation := nextval('game_room_connection.connection_generation_seq');
  insert into game_room_connection.membership_leases(game_type, room_id, user_id, lease_version, phase)
  values(p_game, p_room, p_user, 1, p_phase)
  on conflict(game_type, room_id, user_id) do update
    set lease_version = membership_leases.lease_version + 1, phase = excluded.phase,
        updated_at = clock_timestamp();
  update game_room_connection.connections
  set state = 'disconnected', grace_deadline_at = null,
      disconnected_at = coalesce(disconnected_at, clock_timestamp()), updated_at = clock_timestamp()
  where game_type = p_game and room_id = p_room and user_id = p_user
    and state in ('active', 'grace');
  insert into game_room_connection.connections(
    game_type, room_id, user_id, connection_id, generation, state, grace_deadline_at
  ) values(p_game, p_room, p_user, v_connection, v_generation, 'grace', clock_timestamp() + interval '15 seconds');
end $$;

create function game_room_connection.provision_okey_seat() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, okey, game_room_connection as $$
begin
  if new.user_id is not null and new.membership_released_at is null
     and exists(select 1 from okey.matches where id = new.match_id and status = 'waiting') then
    new.connected := false;
    perform game_room_connection.provision_membership('okey', new.match_id, new.user_id);
  end if;
  return new;
end $$;
create trigger game_room_connection_provision before insert on okey.match_seats
for each row execute function game_room_connection.provision_okey_seat();

create function game_room_connection.provision_domino_1v1_seat() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, game_room_connection as $$
begin
  if new.user_id is not null and coalesce(new.is_bot, false) = false
     and not exists(select 1 from public.one_vs_one_private_states where room_id = new.room_id) then
    new.connected := false;
    perform game_room_connection.provision_membership('domino_1v1', new.room_id, new.user_id);
  end if;
  return new;
end $$;
create trigger game_room_connection_provision before insert on public.one_vs_one_players
for each row execute function game_room_connection.provision_domino_1v1_seat();

create function game_room_connection.provision_domino_2v2_seat() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, game_room_connection as $$
begin
  if new.user_id is not null and coalesce(new.is_bot, false) = false
     and not exists(select 1 from public.two_vs_two_private_states where room_id = new.room_id) then
    new.connected := false;
    perform game_room_connection.provision_membership('domino_2v2', new.room_id, new.user_id);
  end if;
  return new;
end $$;
create trigger game_room_connection_provision before insert on public.two_vs_two_players
for each row execute function game_room_connection.provision_domino_2v2_seat();

-- Public RPC facade: only these functions are visible to PostgREST and only
-- service_role may execute them.
create function public.game_room_connection_issue_ticket(p_user_id uuid) returns text
language sql security invoker set search_path = pg_catalog
as $$ select game_room_connection.issue_ticket(p_user_id) $$;
create function public.game_room_connection_consume_ticket(p_ticket text) returns uuid
language sql security invoker set search_path = pg_catalog
as $$ select game_room_connection.consume_ticket(p_ticket) $$;
create function public.game_room_connection_join_room(p_user uuid,p_game text,p_room uuid,p_connection uuid) returns jsonb
language sql security invoker set search_path = pg_catalog
as $$ select game_room_connection.join_room(p_user,p_game,p_room,p_connection) $$;
create function public.game_room_connection_begin_disconnect(p_user uuid,p_game text,p_room uuid,p_connection uuid,p_generation bigint,p_grace integer default 15) returns boolean
language sql security invoker set search_path = pg_catalog
as $$ select game_room_connection.begin_disconnect(p_user,p_game,p_room,p_connection,p_generation,p_grace) $$;
create function public.game_room_connection_detach_connection(p_user uuid,p_game text,p_room uuid,p_connection uuid,p_generation bigint) returns jsonb
language sql security invoker set search_path = pg_catalog
as $$ select game_room_connection.detach_connection(p_user,p_game,p_room,p_connection,p_generation) $$;
create function public.game_room_connection_sweep_expired_connections(p_limit integer default 100) returns integer
language sql security invoker set search_path = pg_catalog
as $$ select game_room_connection.sweep_expired_connections(p_limit) $$;

revoke all on function public.game_room_connection_issue_ticket(uuid) from public, anon, authenticated;
revoke all on function public.game_room_connection_consume_ticket(text) from public, anon, authenticated;
revoke all on function public.game_room_connection_join_room(uuid,text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.game_room_connection_begin_disconnect(uuid,text,uuid,uuid,bigint,integer) from public, anon, authenticated;
revoke all on function public.game_room_connection_detach_connection(uuid,text,uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.game_room_connection_sweep_expired_connections(integer) from public, anon, authenticated;
grant execute on function public.game_room_connection_issue_ticket(uuid) to service_role;
grant execute on function public.game_room_connection_consume_ticket(text) to service_role;
grant execute on function public.game_room_connection_join_room(uuid,text,uuid,uuid) to service_role;
grant execute on function public.game_room_connection_begin_disconnect(uuid,text,uuid,uuid,bigint,integer) to service_role;
grant execute on function public.game_room_connection_detach_connection(uuid,text,uuid,uuid,bigint) to service_role;
grant execute on function public.game_room_connection_sweep_expired_connections(integer) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'game-room-connection-sweep';
select cron.schedule(
  'game-room-connection-sweep', '5 seconds',
  $$select game_room_connection.sweep_expired_connections(500)$$
);

revoke all on function game_room_connection.provision_membership(text,uuid,uuid,text) from public, anon, authenticated;
