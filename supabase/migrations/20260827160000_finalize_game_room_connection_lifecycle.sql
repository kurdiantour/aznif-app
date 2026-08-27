
-- Finalize the shared game-room connection lifecycle without changing gameplay rules.
-- This migration corrects the initial foundation migration. It intentionally keeps
-- gameplay/manual-leave domain RPCs as the source of truth for voluntary exits.


create or replace function game_room_connection.join_room(
  p_user uuid,
  p_game text,
  p_room uuid,
  p_connection uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, okey, game_room_connection
as $$
declare
  ph text;
  gen bigint;
  ver bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_game || ':' || p_room::text || ':' || p_user::text, 0)
  );

  ph := game_room_connection.resolve_phase(p_game, p_room, p_user, true);
  gen := nextval('game_room_connection.connection_generation_seq');

  insert into game_room_connection.membership_leases
    (game_type, room_id, user_id, lease_version, phase, updated_at)
  values
    (p_game, p_room, p_user, 1, ph, clock_timestamp())
  on conflict (game_type, room_id, user_id)
  do update set
    lease_version = membership_leases.lease_version + 1,
    phase = excluded.phase,
    updated_at = clock_timestamp()
  returning lease_version into ver;

  -- DB-authoritative session takeover: a new generation supersedes every
  -- older physical connection for this user in this exact room.
  update game_room_connection.connections
  set state = 'disconnected',
      grace_deadline_at = null,
      disconnected_at = coalesce(disconnected_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where game_type = p_game
    and room_id = p_room
    and user_id = p_user
    and connection_id <> p_connection
    and state in ('active', 'grace');

  insert into game_room_connection.connections(
    game_type, room_id, user_id, connection_id, generation, state
  )
  values (p_game, p_room, p_user, p_connection, gen, 'active')
  on conflict (game_type, room_id, user_id, connection_id)
  do update set
    generation = excluded.generation,
    state = 'active',
    grace_deadline_at = null,
    disconnected_at = null,
    updated_at = clock_timestamp();

  if p_game = 'okey' then
    update okey.match_seats
    set connected = true
    where match_id = p_room and user_id = p_user;
  elsif p_game = 'domino_1v1' then
    update public.one_vs_one_players
    set connected = true, left_at = null
    where room_id = p_room and user_id = p_user;
  elsif p_game = 'domino_2v2' then
    update public.two_vs_two_players
    set connected = true, left_at = null
    where room_id = p_room and user_id = p_user;
  end if;

  return jsonb_build_object(
    'phase', ph,
    'generation', gen,
    'leaseVersion', ver
  );
end;
$$;

create or replace function game_room_connection.detach_connection(
  p_user uuid,
  p_game text,
  p_room uuid,
  p_connection uuid,
  p_generation bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game_room_connection
as $$
declare
  v_remaining integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  update game_room_connection.connections
  set state = 'disconnected',
      grace_deadline_at = null,
      disconnected_at = coalesce(disconnected_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where game_type = p_game
    and room_id = p_room
    and user_id = p_user
    and connection_id = p_connection
    and generation = p_generation
    and state in ('active', 'grace');

  select count(*) into v_remaining
  from game_room_connection.connections
  where game_type = p_game
    and room_id = p_room
    and user_id = p_user
    and state in ('active', 'grace');

  if v_remaining = 0 then
    delete from game_room_connection.membership_leases
    where game_type = p_game and room_id = p_room and user_id = p_user;
  end if;

  return jsonb_build_object('applied', true, 'released', false, 'phase', 'detached');
end;
$$;

create or replace function game_room_connection.release_waiting(
  p_game text,
  p_room uuid,
  p_user uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, okey, game_room_connection
as $$
declare
  v_count integer := 0;
  v_source text := '';
  v_host uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if p_game = 'okey' then
    -- Reuse Okey's existing authoritative waiting-leave behavior.
    perform public.okey_room_action(
      p_user_id := p_user,
      p_action := 'leave',
      p_match_id := p_room
    );

    select count(*) into v_count
    from okey.match_seats
    where match_id = p_room;

  elsif p_game = 'domino_1v1' then
    select coalesce(metadata ->> 'source', ''), host_user_id
      into v_source, v_host
    from public.one_vs_one_rooms
    where id = p_room
    for update;

    if v_source in ('private_room', 'private_room_10') then
      if v_host = p_user then
        delete from public.one_vs_one_players where room_id = p_room;
      else
        delete from public.one_vs_one_players
        where room_id = p_room and user_id = p_user;
      end if;

      select count(*) into v_count
      from public.one_vs_one_players where room_id = p_room;

      update public.one_vs_one_rooms
      set player_count = v_count,
          status = case when v_count = 0 or v_host = p_user then 'cancelled' else 'waiting' end,
          current_turn_player_id = null,
          version = version + 1,
          updated_at = clock_timestamp()
      where id = p_room;
    else
      -- Public 1v1 rooms are created only after a pair is matched.
      -- Requeue the healthy peer instead of cancelling their search.
      update public.one_vs_one_matchmaking_queue q
      set status = 'searching',
          matched_room_id = null,
          ended_at = null,
          updated_at = clock_timestamp()
      where q.matched_room_id = p_room
        and q.user_id <> p_user
        and q.status in ('searching', 'matched');

      update public.one_vs_one_matchmaking_queue
      set status = 'cancelled',
          matched_room_id = null,
          ended_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where user_id = p_user
        and status in ('searching', 'matched');

      delete from public.one_vs_one_players where room_id = p_room;
      v_count := 0;

      update public.one_vs_one_rooms
      set player_count = 0,
          status = 'cancelled',
          current_turn_player_id = null,
          version = version + 1,
          updated_at = clock_timestamp()
      where id = p_room;
    end if;

  elsif p_game = 'domino_2v2' then
    select coalesce(metadata ->> 'source', ''), host_user_id
      into v_source, v_host
    from public.two_vs_two_rooms
    where id = p_room
    for update;

    if v_source in ('private_room', 'private_room_10') and v_host = p_user then
      delete from public.two_vs_two_players where room_id = p_room;
      v_count := 0;

      update public.two_vs_two_rooms
      set player_count = 0,
          status = 'cancelled',
          current_turn_player_id = null,
          version = version + 1,
          updated_at = clock_timestamp()
      where id = p_room;
    else
      delete from public.two_vs_two_players
      where room_id = p_room and user_id = p_user;

      select count(*) into v_count
      from public.two_vs_two_players where room_id = p_room;

      update public.two_vs_two_rooms
      set player_count = v_count,
          status = case when v_count = 0 then 'cancelled' else 'waiting' end,
          current_turn_player_id = null,
          version = version + 1,
          updated_at = clock_timestamp()
      where id = p_room;

      update public.two_vs_two_matchmaking_queue
      set status = 'cancelled',
          matched_room_id = null,
          ended_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where user_id = p_user
        and status in ('searching', 'matched');

      -- Remaining players keep their room/search state; the existing 2v2
      -- matcher can fill the now-free seat without forcing them to requeue.
      update public.two_vs_two_matchmaking_queue q
      set status = 'searching',
          ended_at = null,
          updated_at = clock_timestamp()
      where q.matched_room_id = p_room
        and q.user_id <> p_user
        and q.status = 'matched'
        and exists (
          select 1 from public.two_vs_two_players p
          where p.room_id = p_room and p.user_id = q.user_id
        );
    end if;

  else
    raise exception 'invalid_game_type';
  end if;

  update public.user_presence
  set status = 'online_available',
      updated_at = clock_timestamp()
  where user_id = p_user;

  delete from game_room_connection.membership_leases
  where game_type = p_game and room_id = p_room and user_id = p_user;

  return v_count;
end;
$$;

create or replace function game_room_connection.sweep_expired_connections(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, game_room_connection
as $$
declare
  r record;
  v_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  for r in
    select user_id, game_type, room_id, connection_id, generation
    from game_room_connection.connections
    where state = 'grace'
      and grace_deadline_at <= clock_timestamp()
    order by grace_deadline_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  loop
    begin
      perform game_room_connection.finish_disconnect(
        r.user_id, r.game_type, r.room_id, r.connection_id, r.generation
      );
      v_count := v_count + 1;
    exception when others then
      -- One stale/broken membership must not block cleanup of other rooms.
      null;
    end;
  end loop;

  return v_count;
end;
$$;

-- Ticket issuance is a guaranteed future-activity checkpoint. This gives grace
-- cleanup a durable lazy fallback even if a gateway instance was restarted.
create or replace function game_room_connection.issue_ticket(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, game_room_connection
as $$
declare
  v text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  perform game_room_connection.sweep_expired_connections(100);

  delete from game_room_connection.auth_tickets
  where expires_at < clock_timestamp() - interval '1 minute';

  insert into game_room_connection.auth_tickets
  values (
    encode(extensions.digest(v, 'sha256'), 'hex'),
    p_user_id,
    clock_timestamp() + interval '30 seconds',
    null,
    clock_timestamp()
  );

  return v;
end;
$$;

revoke all on function game_room_connection.detach_connection(uuid,text,uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function game_room_connection.sweep_expired_connections(integer) from public, anon, authenticated;
grant execute on function game_room_connection.detach_connection(uuid,text,uuid,uuid,bigint) to service_role;
grant execute on function game_room_connection.sweep_expired_connections(integer) to service_role;


