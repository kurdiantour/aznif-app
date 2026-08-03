-- Okey-only room, seat, automatic countdown, matchmaking, and reconnect lifecycle.
alter table okey.matches
  add column table_id text,
  add column room_code text unique,
  add column created_by uuid references auth.users(id) on delete set null,
  add column countdown_deadline_at timestamptz;

alter table okey.match_seats
  add column display_name text not null default '',
  add column avatar_url text,
  add column connected boolean not null default true,
  add column last_seen_at timestamptz not null default now();

create index okey_waiting_matchmaking_idx on okey.matches(table_id, created_at) where status = 'waiting';

create or replace function public.okey_room_action(
  p_user_id uuid,
  p_action text,
  p_match_id uuid default null,
  p_table_id text default null,
  p_display_name text default '',
  p_avatar_url text default null,
  p_state jsonb default null,
  p_projection jsonb default null,
  p_turn_deadline_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_match okey.matches%rowtype;
  v_player_index smallint;
  v_member_count integer;
  v_connected_count integer;
  v_confirmed_count integer;
  v_members jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  if p_user_id is null then raise exception 'user_required' using errcode = '22023'; end if;

  if p_action = 'matchmake' then
    if p_table_id is null or length(p_table_id) > 64 then raise exception 'invalid_table' using errcode = '22023'; end if;
    perform pg_advisory_xact_lock(hashtext('okey-matchmaking:' || p_table_id));
    select match.* into v_match from okey.matches match
    where match.status = 'waiting' and match.table_id = p_table_id
      and (select count(*) from okey.match_seats seat where seat.match_id = match.id) < 4
    order by match.created_at limit 1 for update;
    if not found then
      insert into okey.matches(status, table_id, created_by, room_code)
      values ('waiting', p_table_id, p_user_id, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
      returning * into v_match;
    end if;
    select seat.player_index into v_player_index from okey.match_seats seat
    where seat.match_id = v_match.id and seat.user_id = p_user_id;
    if not found then
      select candidate into v_player_index from generate_series(0, 3) candidate
      where not exists (select 1 from okey.match_seats seat where seat.match_id = v_match.id and seat.player_index = candidate)
      order by candidate limit 1;
      if v_player_index is null then raise exception 'room_full' using errcode = 'P0001'; end if;
      insert into okey.match_seats(match_id, user_id, player_index, team_id, display_name, avatar_url)
      values (v_match.id, p_user_id, v_player_index,
        case when v_player_index in (0, 2) then 'teamA' else 'teamB' end,
        left(coalesce(nullif(trim(p_display_name), ''), 'Player'), 64), p_avatar_url);
    else
      update okey.match_seats set connected = true, last_seen_at = now()
      where match_id = v_match.id and user_id = p_user_id;
    end if;
  elsif p_action in ('status', 'heartbeat', 'reconnect', 'leave', 'start') then
    select match.* into v_match from okey.matches match where match.id = p_match_id for update;
    if not found then raise exception 'match_not_found' using errcode = 'P0002'; end if;
    if not exists (select 1 from okey.match_seats seat where seat.match_id = v_match.id and seat.user_id = p_user_id)
      then raise exception 'not_a_participant' using errcode = '42501'; end if;
    if p_action in ('status', 'heartbeat', 'reconnect', 'start') then
      update okey.match_seats set connected = true, last_seen_at = now()
      where match_id = v_match.id and user_id = p_user_id;
    elsif p_action = 'leave' then
      if v_match.status = 'waiting' then
        delete from okey.match_seats where match_id = v_match.id and user_id = p_user_id;
      else
        update okey.match_seats set connected = false, last_seen_at = now()
        where match_id = v_match.id and user_id = p_user_id;
      end if;
    end if;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  select match.* into v_match from okey.matches match where match.id = coalesce(p_match_id, v_match.id) for update;
  update okey.match_seats set connected = false
  where match_id = v_match.id and connected and last_seen_at < now() - interval '4 seconds';
  select count(*), count(*) filter (where connected),
    count(*) filter (where connected and v_match.countdown_deadline_at is not null and last_seen_at >= v_match.countdown_deadline_at)
  into v_member_count, v_connected_count, v_confirmed_count
  from okey.match_seats where match_id = v_match.id;

  if v_match.status = 'waiting' then
    if v_member_count = 4 and v_connected_count = 4 then
      if v_match.countdown_deadline_at is null then
        update okey.matches set countdown_deadline_at = now() + interval '5 seconds', updated_at = now()
        where id = v_match.id returning * into v_match;
      end if;
    elsif v_match.countdown_deadline_at is not null then
      update okey.matches set countdown_deadline_at = null, updated_at = now()
      where id = v_match.id returning * into v_match;
    end if;
  end if;

  if p_action = 'start' then
    if v_match.status <> 'waiting' or v_member_count <> 4 or v_connected_count <> 4 or v_confirmed_count <> 4
      or v_match.countdown_deadline_at is null or v_match.countdown_deadline_at > now()
      then raise exception 'countdown_not_complete' using errcode = 'P0001'; end if;
    if p_state is null or p_projection is null or p_turn_deadline_at is null
      then raise exception 'initial_state_required' using errcode = '22023'; end if;
    insert into okey.match_private_states(match_id, state) values (v_match.id, p_state)
    on conflict (match_id) do nothing;
    if not found then raise exception 'match_already_started' using errcode = 'P0001'; end if;
    update okey.matches set status = 'playing', version = 0, public_projection = p_projection,
      turn_deadline_at = p_turn_deadline_at, countdown_deadline_at = null, updated_at = now()
    where id = v_match.id returning * into v_match;
  elsif p_action = 'leave' and v_member_count = 0 then
    update okey.matches set status = 'cancelled', countdown_deadline_at = null, updated_at = now()
    where id = v_match.id returning * into v_match;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', user_id, 'playerIndex', player_index, 'teamId', team_id,
    'displayName', display_name, 'avatarUrl', avatar_url, 'connected', connected
  ) order by player_index), '[]'::jsonb) into v_members
  from okey.match_seats where match_id = v_match.id;
  return jsonb_build_object(
    'matchId', v_match.id, 'roomCode', v_match.room_code, 'tableId', v_match.table_id,
    'status', v_match.status, 'version', v_match.version,
    'memberCount', v_member_count, 'connectedCount', v_connected_count, 'confirmedCount', v_confirmed_count,
    'countdownEndsAt', v_match.countdown_deadline_at,
    'shouldStart', v_match.status = 'waiting' and v_member_count = 4 and v_connected_count = 4
      and v_confirmed_count = 4 and v_match.countdown_deadline_at is not null and v_match.countdown_deadline_at <= now(),
    'members', v_members
  );
end;
$$;

revoke all on function public.okey_room_action(uuid, text, uuid, text, text, text, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.okey_room_action(uuid, text, uuid, text, text, text, jsonb, jsonb, timestamptz) to service_role;