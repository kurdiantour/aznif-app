-- Preserve the full 1v1 countdown during shared stale-seat cleanup.
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
          (select count(*) from okey.match_seats seat where seat.match_id = match.id) < (case when match.mode = '1v1' then 2 else 4 end)
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
revoke all on function public.expire_stale_waiting_room_members(integer) from public, anon, authenticated;
grant execute on function public.expire_stale_waiting_room_members(integer) to service_role;
