-- A shared deadline makes every client's countdown refer to the same room state.
alter table public.one_vs_one_rooms add column if not exists countdown_deadline_at timestamptz;
alter table public.two_vs_two_rooms add column if not exists countdown_deadline_at timestamptz;

create or replace function public.refresh_domino_waiting_countdown()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_room_id uuid := coalesce(new.room_id, old.room_id);
  v_count integer;
  v_connected integer;
  v_started boolean;
begin
  if tg_table_name = 'one_vs_one_players' then
    perform 1 from public.one_vs_one_rooms where id = v_room_id for update;
    if not found then return null; end if;
    select exists(select 1 from public.one_vs_one_private_states where room_id = v_room_id) into v_started;
    if v_started then return null; end if;
    select count(*), count(*) filter (where connected and user_id is not null
      and coalesce(last_seen_at, updated_at) >= clock_timestamp() - interval '150 seconds')
      into v_count, v_connected from public.one_vs_one_players where room_id = v_room_id;
    update public.one_vs_one_rooms
      set status = case when status = 'active' then 'waiting' else status end,
        countdown_deadline_at = case
        when v_count = 2 and v_connected = 2 then coalesce(countdown_deadline_at, clock_timestamp() + interval '5 seconds')
        else null end,
        updated_at = clock_timestamp()
      where id = v_room_id and status in ('waiting', 'active');
  else
    perform 1 from public.two_vs_two_rooms where id = v_room_id for update;
    if not found then return null; end if;
    select exists(select 1 from public.two_vs_two_private_states where room_id = v_room_id) into v_started;
    if v_started then return null; end if;
    select count(*), count(*) filter (where connected and user_id is not null
      and coalesce(last_seen_at, updated_at) >= clock_timestamp() - interval '150 seconds')
      into v_count, v_connected from public.two_vs_two_players where room_id = v_room_id;
    update public.two_vs_two_rooms
      set status = case when status = 'active' then 'waiting' else status end,
        countdown_deadline_at = case
        when v_count = 4 and v_connected = 4 then coalesce(countdown_deadline_at, clock_timestamp() + interval '5 seconds')
        else null end,
        updated_at = clock_timestamp()
      where id = v_room_id and status in ('waiting', 'active');
  end if;
  return null;
end;
$$;

create trigger one_vs_one_waiting_countdown
after insert or delete or update of connected on public.one_vs_one_players
for each row execute function public.refresh_domino_waiting_countdown();
create trigger two_vs_two_waiting_countdown
after insert or delete or update of connected on public.two_vs_two_players
for each row execute function public.refresh_domino_waiting_countdown();

-- Existing matchmakers use active to mean "all seats allocated". Keep the
-- database room waiting until its private game state is actually committed.
create or replace function public.keep_domino_pregame_waiting()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status <> 'active' then return null; end if;
  if tg_table_name = 'one_vs_one_rooms' then
    if not exists(select 1 from public.one_vs_one_private_states where room_id = new.id) then
      update public.one_vs_one_rooms set status = 'waiting' where id = new.id;
    end if;
  else
    if not exists(select 1 from public.two_vs_two_private_states where room_id = new.id) then
      update public.two_vs_two_rooms set status = 'waiting' where id = new.id;
    end if;
  end if;
  return null;
end;
$$;
create trigger one_vs_one_pregame_status
after update of status on public.one_vs_one_rooms
for each row when (new.status = 'active') execute function public.keep_domino_pregame_waiting();
create trigger two_vs_two_pregame_status
after update of status on public.two_vs_two_rooms
for each row when (new.status = 'active') execute function public.keep_domino_pregame_waiting();

-- The start RPCs already lock the room row. This check runs in their transaction
-- before the first private state is committed, including concurrent starts.
create or replace function public.guard_domino_waiting_start()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_deadline timestamptz;
  v_count integer;
  v_connected integer;
  v_required integer;
begin
  if tg_table_name = 'one_vs_one_private_states' then
    if exists(select 1 from public.one_vs_one_private_states where room_id = new.room_id) then
      return new;
    end if;
    v_required := 2;
    select countdown_deadline_at into v_deadline from public.one_vs_one_rooms where id = new.room_id for update;
    select count(*), count(*) filter (where connected and user_id is not null
      and coalesce(last_seen_at, updated_at) >= clock_timestamp() - interval '150 seconds')
      into v_count, v_connected from public.one_vs_one_players where room_id = new.room_id;
  else
    if exists(select 1 from public.two_vs_two_private_states where room_id = new.room_id) then
      return new;
    end if;
    v_required := 4;
    select countdown_deadline_at into v_deadline from public.two_vs_two_rooms where id = new.room_id for update;
    select count(*), count(*) filter (where connected and user_id is not null
      and coalesce(last_seen_at, updated_at) >= clock_timestamp() - interval '150 seconds')
      into v_count, v_connected from public.two_vs_two_players where room_id = new.room_id;
  end if;
  if v_deadline is null or v_deadline > clock_timestamp()
     or v_count <> v_required or v_connected <> v_required then
    raise exception 'countdown_not_complete' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger one_vs_one_waiting_start_guard
before insert on public.one_vs_one_private_states
for each row execute function public.guard_domino_waiting_start();
create trigger two_vs_two_waiting_start_guard
before insert on public.two_vs_two_private_states
for each row execute function public.guard_domino_waiting_start();

create or replace function public.finish_domino_waiting_countdown()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'one_vs_one_private_states' then
    update public.one_vs_one_rooms set countdown_deadline_at = null where id = new.room_id;
  else
    update public.two_vs_two_rooms set countdown_deadline_at = null where id = new.room_id;
  end if;
  return null;
end;
$$;
create trigger one_vs_one_waiting_start_finished
after insert on public.one_vs_one_private_states
for each row execute function public.finish_domino_waiting_countdown();
create trigger two_vs_two_waiting_start_finished
after insert on public.two_vs_two_private_states
for each row execute function public.finish_domino_waiting_countdown();

-- Resolve the room from server-owned membership when a client has not yet
-- received the matchmaking result. Keep the existing atomic release behavior.
alter function public.cancel_one_vs_one_matchmaking(uuid) rename to cancel_one_vs_one_matchmaking_legacy;
alter function public.cancel_two_vs_two_matchmaking(uuid) rename to cancel_two_vs_two_matchmaking_legacy;

create function public.cancel_one_vs_one_matchmaking(p_room_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_deadline timestamptz;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select p.room_id into v_room_id from public.one_vs_one_players p
    join public.one_vs_one_rooms r on r.id = p.room_id
    where p.user_id = v_uid and r.status in ('waiting', 'active')
      and not exists(select 1 from public.one_vs_one_private_states s where s.room_id = r.id)
      and (p_room_id is null or p.room_id = p_room_id)
    order by r.created_at desc limit 1;
  if p_room_id is not null and v_room_id is null then
    raise exception 'waiting_membership_not_found' using errcode = 'P0002';
  end if;
  if v_room_id is not null then
    select countdown_deadline_at into v_deadline from public.one_vs_one_rooms where id = v_room_id for update;
    if v_deadline is not null then
      raise exception 'countdown_in_progress' using errcode = 'P0001';
    end if;
  end if;
  return public.cancel_one_vs_one_matchmaking_legacy(v_room_id);
end;
$$;

create function public.cancel_two_vs_two_matchmaking(p_room_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_deadline timestamptz;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select p.room_id into v_room_id from public.two_vs_two_players p
    join public.two_vs_two_rooms r on r.id = p.room_id
    where p.user_id = v_uid and r.status in ('waiting', 'active')
      and not exists(select 1 from public.two_vs_two_private_states s where s.room_id = r.id)
      and (p_room_id is null or p.room_id = p_room_id)
    order by r.created_at desc limit 1;
  if p_room_id is not null and v_room_id is null then
    raise exception 'waiting_membership_not_found' using errcode = 'P0002';
  end if;
  if v_room_id is not null then
    select countdown_deadline_at into v_deadline from public.two_vs_two_rooms where id = v_room_id for update;
    if v_deadline is not null then
      raise exception 'countdown_in_progress' using errcode = 'P0001';
    end if;
  end if;
  return public.cancel_two_vs_two_matchmaking_legacy(v_room_id);
end;
$$;

revoke all on function public.cancel_one_vs_one_matchmaking(uuid) from public, anon;
revoke all on function public.cancel_two_vs_two_matchmaking(uuid) from public, anon;
grant execute on function public.cancel_one_vs_one_matchmaking(uuid) to authenticated;
grant execute on function public.cancel_two_vs_two_matchmaking(uuid) to authenticated;
revoke all on function public.cancel_one_vs_one_matchmaking_legacy(uuid) from public, anon, authenticated;
revoke all on function public.cancel_two_vs_two_matchmaking_legacy(uuid) from public, anon, authenticated;

create or replace function public.domino_waiting_room_status(p_mode text, p_room_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := p_room_id;
  v_status text;
  v_deadline timestamptz;
  v_count integer;
  v_connected integer;
  v_started boolean;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_mode not in ('1v1', '2v2') then raise exception 'invalid_domino_mode' using errcode = '22023'; end if;
  if p_mode = '1v1' then
    if v_room_id is null then
      select p.room_id into v_room_id from public.one_vs_one_players p
        join public.one_vs_one_rooms r on r.id = p.room_id
        where p.user_id = v_uid and r.status in ('waiting', 'active')
          and not exists(select 1 from public.one_vs_one_private_states s where s.room_id = r.id)
        order by r.created_at desc limit 1;
    end if;
    if v_room_id is null then return jsonb_build_object('status', 'searching'); end if;
    if not exists(select 1 from public.one_vs_one_players where room_id = v_room_id and user_id = v_uid) then
      raise exception 'waiting_membership_not_found' using errcode = 'P0002'; end if;
    if not exists(select 1 from public.one_vs_one_private_states where room_id = v_room_id) then
      insert into public.user_presence(user_id, status, last_seen_at, updated_at)
        values(v_uid, 'matchmaking', clock_timestamp(), clock_timestamp())
        on conflict(user_id) do update set status = excluded.status,
          last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at;
    end if;
    update public.one_vs_one_players set connected = true, last_seen_at = clock_timestamp(),
      updated_at = clock_timestamp() where room_id = v_room_id and user_id = v_uid
      and (connected = false or last_seen_at < clock_timestamp() - interval '30 seconds');
    update public.one_vs_one_players set connected = false, updated_at = clock_timestamp()
      where room_id = v_room_id and connected = true
        and last_seen_at < clock_timestamp() - interval '150 seconds';
    if exists(select 1 from public.one_vs_one_players where room_id = v_room_id
      and last_seen_at < clock_timestamp() - interval '150 seconds') then
      perform public.expire_stale_waiting_room_members(150);
    end if;
    select status, countdown_deadline_at into v_status, v_deadline from public.one_vs_one_rooms where id = v_room_id;
    select count(*), count(*) filter (where connected and user_id is not null
      and coalesce(last_seen_at, updated_at) >= clock_timestamp() - interval '150 seconds')
      into v_count, v_connected from public.one_vs_one_players where room_id = v_room_id;
    select exists(select 1 from public.one_vs_one_private_states where room_id = v_room_id) into v_started;
    if not v_started and v_deadline is not null and v_deadline <= clock_timestamp()
       and v_count = 2 and v_connected = 2 then
      perform public.start_one_vs_one_game(v_room_id);
      v_started := true;
      v_deadline := null;
    end if;
  else
    if v_room_id is null then
      select p.room_id into v_room_id from public.two_vs_two_players p
        join public.two_vs_two_rooms r on r.id = p.room_id
        where p.user_id = v_uid and r.status in ('waiting', 'active')
          and not exists(select 1 from public.two_vs_two_private_states s where s.room_id = r.id)
        order by r.created_at desc limit 1;
    end if;
    if v_room_id is null then return jsonb_build_object('status', 'searching'); end if;
    if not exists(select 1 from public.two_vs_two_players where room_id = v_room_id and user_id = v_uid) then
      raise exception 'waiting_membership_not_found' using errcode = 'P0002'; end if;
    if not exists(select 1 from public.two_vs_two_private_states where room_id = v_room_id) then
      insert into public.user_presence(user_id, status, last_seen_at, updated_at)
        values(v_uid, 'matchmaking', clock_timestamp(), clock_timestamp())
        on conflict(user_id) do update set status = excluded.status,
          last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at;
    end if;
    update public.two_vs_two_players set connected = true, last_seen_at = clock_timestamp(),
      updated_at = clock_timestamp() where room_id = v_room_id and user_id = v_uid
      and (connected = false or last_seen_at < clock_timestamp() - interval '30 seconds');
    update public.two_vs_two_players set connected = false, updated_at = clock_timestamp()
      where room_id = v_room_id and connected = true
        and last_seen_at < clock_timestamp() - interval '150 seconds';
    if exists(select 1 from public.two_vs_two_players where room_id = v_room_id
      and last_seen_at < clock_timestamp() - interval '150 seconds') then
      perform public.expire_stale_waiting_room_members(150);
    end if;
    select status, countdown_deadline_at into v_status, v_deadline from public.two_vs_two_rooms where id = v_room_id;
    select count(*), count(*) filter (where connected and user_id is not null
      and coalesce(last_seen_at, updated_at) >= clock_timestamp() - interval '150 seconds')
      into v_count, v_connected from public.two_vs_two_players where room_id = v_room_id;
    select exists(select 1 from public.two_vs_two_private_states where room_id = v_room_id) into v_started;
    if not v_started and v_deadline is not null and v_deadline <= clock_timestamp()
       and v_count = 4 and v_connected = 4 then
      perform public.start_two_vs_two_game(v_room_id);
      v_started := true;
      v_deadline := null;
    end if;
  end if;
  return jsonb_build_object('status', v_status, 'roomId', v_room_id,
    'countdownEndsAt', v_deadline, 'memberCount', v_count,
    'connectedCount', v_connected, 'started', v_started);
end;
$$;
revoke all on function public.domino_waiting_room_status(text, uuid) from public, anon;
grant execute on function public.domino_waiting_room_status(text, uuid) to authenticated;
revoke all on function public.refresh_domino_waiting_countdown() from public, anon, authenticated;
revoke all on function public.guard_domino_waiting_start() from public, anon, authenticated;
revoke all on function public.keep_domino_pregame_waiting() from public, anon, authenticated;
revoke all on function public.finish_domino_waiting_countdown() from public, anon, authenticated;

-- Existing full rooms also need a common deadline after the migration lands.
update public.one_vs_one_rooms r set countdown_deadline_at = clock_timestamp() + interval '5 seconds'
where r.status in ('waiting', 'active') and not exists(select 1 from public.one_vs_one_private_states s where s.room_id = r.id)
  and (select count(*) from public.one_vs_one_players p where p.room_id = r.id) = 2
  and (select count(*) from public.one_vs_one_players p where p.room_id = r.id and p.connected and p.user_id is not null) = 2;
update public.two_vs_two_rooms r set countdown_deadline_at = clock_timestamp() + interval '5 seconds'
where r.status in ('waiting', 'active') and not exists(select 1 from public.two_vs_two_private_states s where s.room_id = r.id)
  and (select count(*) from public.two_vs_two_players p where p.room_id = r.id) = 4
  and (select count(*) from public.two_vs_two_players p where p.room_id = r.id and p.connected and p.user_id is not null) = 4;

update public.one_vs_one_rooms r set status = 'waiting'
where r.status = 'active' and not exists(select 1 from public.one_vs_one_private_states s where s.room_id = r.id);
update public.two_vs_two_rooms r set status = 'waiting'
where r.status = 'active' and not exists(select 1 from public.two_vs_two_private_states s where s.room_id = r.id);

notify pgrst, 'reload schema';
