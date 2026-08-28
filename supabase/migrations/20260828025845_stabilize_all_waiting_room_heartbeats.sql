-- Stable database-owned lifecycle for every pre-game Waiting Room.
-- Gameplay rooms are deliberately excluded: timeout/takeover remains owned by
-- each game's authoritative gameplay lifecycle.

create index if not exists one_vs_one_waiting_presence_idx
  on public.one_vs_one_players (room_id, last_seen_at)
  where user_id is not null and abandoned = false;

create index if not exists two_vs_two_waiting_presence_idx
  on public.two_vs_two_players (room_id, last_seen_at)
  where user_id is not null and abandoned = false;

create index if not exists okey_waiting_seat_presence_idx
  on okey.match_seats (match_id, last_seen_at)
  where membership_released_at is null;

create or replace function public.expire_stale_waiting_room_members(
  p_stale_seconds integer default 150
)
returns jsonb
language plpgsql
security definer
set search_path = public, okey, pg_temp
as $$
declare
  v_cutoff timestamptz;
  v_one_users uuid[] := '{}'::uuid[];
  v_two_users uuid[] := '{}'::uuid[];
  v_okey_users uuid[] := '{}'::uuid[];
  v_one_count integer := 0;
  v_two_count integer := 0;
  v_okey_count integer := 0;
begin
  if p_stale_seconds < 90 or p_stale_seconds > 900 then
    raise exception 'invalid_stale_seconds' using errcode = '22023';
  end if;
  v_cutoff := clock_timestamp() - make_interval(secs => p_stale_seconds);

  with deleted as (
    delete from public.one_vs_one_players player
    using public.one_vs_one_rooms room
    where room.id = player.room_id
      and room.status = 'waiting'
      and player.user_id is not null
      and player.abandoned = false
      and coalesce(player.last_seen_at, player.updated_at) < v_cutoff
    returning player.user_id
  )
  select coalesce(array_agg(user_id), '{}'::uuid[]), count(*)
  into v_one_users, v_one_count from deleted;

  update public.one_vs_one_matchmaking_queue queue
  set status = 'cancelled', matched_room_id = null,
      ended_at = clock_timestamp(), updated_at = clock_timestamp()
  where queue.status in ('searching', 'matched')
    and (
      (queue.matched_room_id is null and queue.updated_at < v_cutoff)
      or (queue.matched_room_id is not null and not exists (
        select 1 from public.one_vs_one_players player
        where player.room_id = queue.matched_room_id
          and player.user_id = queue.user_id
      ))
    );

  update public.one_vs_one_rooms room
  set player_count = greatest(1, (select count(*)::integer from public.one_vs_one_players player where player.room_id = room.id)),
      status = case when not exists (select 1 from public.one_vs_one_players player where player.room_id = room.id) then 'cancelled' else 'waiting' end,
      current_turn_player_id = null,
      version = room.version + 1,
      updated_at = clock_timestamp()
  where room.status = 'waiting'
    and room.player_count is distinct from greatest(1, (select count(*)::integer from public.one_vs_one_players player where player.room_id = room.id));

  with deleted as (    delete from public.two_vs_two_players player
    using public.two_vs_two_rooms room
    where room.id = player.room_id
      and room.status = 'waiting'
      and player.user_id is not null
      and player.abandoned = false
      and coalesce(player.last_seen_at, player.updated_at) < v_cutoff
    returning player.user_id
  )
  select coalesce(array_agg(user_id), '{}'::uuid[]), count(*)
  into v_two_users, v_two_count from deleted;

  update public.two_vs_two_matchmaking_queue queue
  set status = 'cancelled', matched_room_id = null,
      ended_at = clock_timestamp(), updated_at = clock_timestamp()
  where queue.status in ('searching', 'matched')
    and (
      (queue.matched_room_id is null and queue.updated_at < v_cutoff)
      or (queue.matched_room_id is not null and not exists (
        select 1 from public.two_vs_two_players player
        where player.room_id = queue.matched_room_id
          and player.user_id = queue.user_id
      ))
    );

  update public.two_vs_two_rooms room
  set player_count = (select count(*)::integer from public.two_vs_two_players player where player.room_id = room.id),
      status = case when not exists (select 1 from public.two_vs_two_players player where player.room_id = room.id) then 'cancelled' else 'waiting' end,
      current_turn_player_id = null,
      version = room.version + 1,
      updated_at = clock_timestamp()
  where room.status = 'waiting'
    and room.player_count is distinct from (select count(*)::integer from public.two_vs_two_players player where player.room_id = room.id);

  with deleted as (    delete from okey.match_seats seat
    using okey.matches match
    where match.id = seat.match_id
      and match.status = 'waiting'
      and seat.membership_released_at is null
      and coalesce(seat.last_seen_at, seat.joined_at) < v_cutoff
    returning seat.user_id
  )
  select coalesce(array_agg(user_id), '{}'::uuid[]), count(*)
  into v_okey_users, v_okey_count from deleted;

  update okey.matches match
  set status = case when not exists (select 1 from okey.match_seats seat where seat.match_id = match.id) then 'cancelled' else 'waiting' end,
      countdown_deadline_at = null,
      updated_at = clock_timestamp()
  where match.status = 'waiting'
    and (
      not exists (select 1 from okey.match_seats seat where seat.match_id = match.id)
      or (
        match.countdown_deadline_at is not null
        and (
          (select count(*) from okey.match_seats seat where seat.match_id = match.id) < 4
          or exists (select 1 from okey.match_seats seat where seat.match_id = match.id and seat.connected = false)
        )
      )
    );

  update public.user_presence presence  set status = 'online_available', last_seen_at = clock_timestamp(), updated_at = clock_timestamp()
  where presence.user_id = any(v_one_users || v_two_users || v_okey_users)
    and not exists (
      select 1 from public.one_vs_one_players player
      join public.one_vs_one_rooms room on room.id = player.room_id and room.status = 'waiting'
      where player.user_id = presence.user_id
    )
    and not exists (
      select 1 from public.two_vs_two_players player
      join public.two_vs_two_rooms room on room.id = player.room_id and room.status = 'waiting'
      where player.user_id = presence.user_id
    )
    and not exists (
      select 1 from okey.match_seats seat
      join okey.matches match on match.id = seat.match_id and match.status = 'waiting'
      where seat.user_id = presence.user_id
    );

  update public.domino_parties party
  set flow_status = 'idle', current_room_id = null, current_mode = null,
      current_currency = null, current_entry_fee = null,
      command_version = party.command_version + 1, updated_at = clock_timestamp()
  where party.status = 'active' and party.flow_status = 'matchmaking'
    and party.current_room_id is not null
    and not exists (
      select 1 from public.domino_party_members member
      where member.party_id = party.id and (
        exists (select 1 from public.one_vs_one_players player where player.room_id = party.current_room_id and player.user_id = member.user_id)
        or exists (select 1 from public.two_vs_two_players player where player.room_id = party.current_room_id and player.user_id = member.user_id)
        or exists (select 1 from okey.match_seats seat where seat.match_id = party.current_room_id and seat.user_id = member.user_id)
      )
    );

  return jsonb_build_object(
    'oneVsOneExpired', v_one_count,
    'twoVsTwoExpired', v_two_count,
    'okeyExpired', v_okey_count
  );
end;
$$;

revoke all on function public.expire_stale_waiting_room_members(integer)
  from public, anon, authenticated;
grant execute on function public.expire_stale_waiting_room_members(integer)
  to service_role;

create or replace function public.domino_waiting_room_heartbeat(
  p_mode text,
  p_room_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_updated integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_mode not in ('1v1', '2v2') then
    raise exception 'invalid_domino_mode' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('domino-waiting:' || v_uid::text, 0));

  if p_mode = '1v1' then
    if p_room_id is not null then
      update public.one_vs_one_players player
      set connected = true, last_seen_at = clock_timestamp(), left_at = null,
          updated_at = clock_timestamp()
      from public.one_vs_one_rooms room
      where room.id = p_room_id and room.status = 'waiting'
        and player.room_id = room.id and player.user_id = v_uid
        and player.abandoned = false;
      get diagnostics v_updated = row_count;
    else
      update public.one_vs_one_matchmaking_queue
      set updated_at = clock_timestamp()
      where user_id = v_uid and status = 'searching';
      get diagnostics v_updated = row_count;
    end if;
  else
    if p_room_id is null then
      raise exception 'room_id_required' using errcode = '22023';
    end if;
    update public.two_vs_two_players player
    set connected = true, last_seen_at = clock_timestamp(), left_at = null,
        updated_at = clock_timestamp()
    from public.two_vs_two_rooms room
    where room.id = p_room_id and room.status = 'waiting'
      and player.room_id = room.id and player.user_id = v_uid
      and player.abandoned = false;
    get diagnostics v_updated = row_count;
  end if;

  if v_updated = 0 and p_room_id is not null and (
    (p_mode = '1v1' and exists (
      select 1 from public.one_vs_one_players player
      join public.one_vs_one_rooms room on room.id = player.room_id
      where player.room_id = p_room_id and player.user_id = v_uid and room.status = 'active'
    ))
    or (p_mode = '2v2' and exists (
      select 1 from public.two_vs_two_players player
      join public.two_vs_two_rooms room on room.id = player.room_id
      where player.room_id = p_room_id and player.user_id = v_uid and room.status = 'active'
    ))
  ) then
    return jsonb_build_object('status', 'not_waiting', 'mode', p_mode, 'room_id', p_room_id);
  end if;

  if v_updated = 0 then
    raise exception 'waiting_membership_not_found' using errcode = 'P0002';
  end if;

  insert into public.user_presence(user_id, status, last_seen_at, updated_at)
  values(v_uid, 'matchmaking', clock_timestamp(), clock_timestamp())
  on conflict(user_id) do update
  set status = excluded.status, last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at;

  perform public.expire_stale_waiting_room_members(150);
  return jsonb_build_object('status', 'ok', 'mode', p_mode, 'room_id', p_room_id);
end;
$$;

revoke all on function public.domino_waiting_room_heartbeat(text, uuid)
  from public, anon;
grant execute on function public.domino_waiting_room_heartbeat(text, uuid)
  to authenticated;


-- Repair already-stale rows when this migration is deployed.
select public.expire_stale_waiting_room_members(150);