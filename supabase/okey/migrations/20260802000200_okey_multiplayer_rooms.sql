-- ============================================================================
-- Okey room lifecycle only
--
-- Handles:
--   matchmaking
--   four-player rooms
--   team assignment
--   heartbeat / presence
--   reconnect
--   waiting-room countdown
--   authoritative match start
--   leave lifecycle
--
-- No Domino object is referenced.
-- ============================================================================


-- ============================================================================
-- 1. Match and seat fields
-- ============================================================================

alter table okey.matches
  add column if not exists table_id text,

  add column if not exists room_code text,

  add column if not exists created_by uuid
    references auth.users(id)
    on delete set null,

  add column if not exists countdown_deadline_at timestamptz;


alter table okey.match_seats
  add column if not exists display_name text
    not null default '',

  add column if not exists avatar_url text,

  add column if not exists connected boolean
    not null default true,

  add column if not exists last_seen_at timestamptz
    not null default now();


-- Every generated room code must be unique.
create unique index if not exists okey_matches_room_code_uidx
  on okey.matches(room_code)
  where room_code is not null;


-- A player can occupy only one seat in a match.
create unique index if not exists okey_match_seats_match_user_uidx
  on okey.match_seats(match_id, user_id);


-- A player index can be occupied only once in a match.
create unique index if not exists okey_match_seats_match_player_index_uidx
  on okey.match_seats(match_id, player_index);


-- Speeds up searching for available waiting rooms.
create index if not exists okey_waiting_matchmaking_idx
  on okey.matches(table_id, created_at)
  where status = 'waiting';


-- Speeds up active-match lookup for reconnect and duplicate prevention.
create index if not exists okey_match_seats_user_idx
  on okey.match_seats(user_id, match_id);


-- ============================================================================
-- 2. Room action
-- ============================================================================

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
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_match okey.matches%rowtype;

  v_existing_match_id uuid;

  v_player_index smallint;

  v_member_count integer := 0;
  v_connected_count integer := 0;
  v_confirmed_count integer := 0;

  v_members jsonb := '[]'::jsonb;
begin
  -- --------------------------------------------------------------------------
  -- Security
  -- --------------------------------------------------------------------------

  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'user_required'
      using errcode = '22023';
  end if;

  if p_action is null then
    raise exception 'action_required'
      using errcode = '22023';
  end if;


  -- ==========================================================================
  -- MATCHMAKE
  -- ==========================================================================

  if p_action = 'matchmake' then

    if p_table_id is null
       or length(trim(p_table_id)) = 0
       or length(p_table_id) > 64 then
      raise exception 'invalid_table'
        using errcode = '22023';
    end if;


    /*
     * Prevent the same user from entering multiple active Okey matches.
     * If the user already has a waiting or playing match, reconnect to it.
     */
    select match.id
    into v_existing_match_id
    from okey.match_seats seat
    join okey.matches match
      on match.id = seat.match_id
    where seat.user_id = p_user_id
      and match.status in ('waiting', 'playing')
    order by
      case
        when match.status = 'playing' then 0
        else 1
      end,
      match.created_at desc
    limit 1
    for update of match;


    if v_existing_match_id is not null then

      select match.*
      into v_match
      from okey.matches match
      where match.id = v_existing_match_id
      for update;

      update okey.match_seats
      set
        connected = true,
        last_seen_at = now(),
        display_name = left(
          coalesce(
            nullif(trim(p_display_name), ''),
            display_name,
            'Player'
          ),
          64
        ),
        avatar_url = coalesce(
          p_avatar_url,
          avatar_url
        )
      where match_id = v_match.id
        and user_id = p_user_id;

    else

      /*
       * Only one transaction may allocate a seat for this table at a time.
       */
      perform pg_advisory_xact_lock(
        hashtext(
          'okey-matchmaking:' || trim(p_table_id)
        )
      );


      /*
       * Find the oldest waiting room with fewer than four players.
       */
      select match.*
      into v_match
      from okey.matches match
      where match.status = 'waiting'
        and match.table_id = trim(p_table_id)
        and (
          select count(*)
          from okey.match_seats seat
          where seat.match_id = match.id
        ) < 4
      order by match.created_at
      limit 1
      for update;


      /*
       * Create a new waiting room when no suitable room exists.
       */
      if not found then
        insert into okey.matches (
          status,
          table_id,
          created_by,
          room_code,
          countdown_deadline_at
        )
        values (
          'waiting',
          trim(p_table_id),
          p_user_id,
          upper(
            substr(
              replace(
                gen_random_uuid()::text,
                '-',
                ''
              ),
              1,
              8
            )
          ),
          null
        )
        returning *
        into v_match;
      end if;


      /*
       * Find the first free player index.
       *
       * Teams:
       *   indices 0 and 2 -> teamA
       *   indices 1 and 3 -> teamB
       */
      select candidate::smallint
      into v_player_index
      from generate_series(0, 3) candidate
      where not exists (
        select 1
        from okey.match_seats seat
        where seat.match_id = v_match.id
          and seat.player_index = candidate
      )
      order by candidate
      limit 1;


      if v_player_index is null then
        raise exception 'room_full'
          using errcode = 'P0001';
      end if;


      insert into okey.match_seats (
        match_id,
        user_id,
        player_index,
        team_id,
        display_name,
        avatar_url,
        connected,
        last_seen_at
      )
      values (
        v_match.id,
        p_user_id,
        v_player_index,

        case
          when v_player_index in (0, 2)
            then 'teamA'
          else 'teamB'
        end,

        left(
          coalesce(
            nullif(trim(p_display_name), ''),
            'Player'
          ),
          64
        ),

        p_avatar_url,
        true,
        now()
      );

    end if;


  -- ==========================================================================
  -- EXISTING ROOM ACTIONS
  -- ==========================================================================

  elsif p_action in (
    'status',
    'heartbeat',
    'reconnect',
    'leave',
    'start'
  ) then

    if p_match_id is null then
      raise exception 'match_id_required'
        using errcode = '22023';
    end if;


    select match.*
    into v_match
    from okey.matches match
    where match.id = p_match_id
    for update;


    if not found then
      raise exception 'match_not_found'
        using errcode = 'P0002';
    end if;


    if not exists (
      select 1
      from okey.match_seats seat
      where seat.match_id = v_match.id
        and seat.user_id = p_user_id
    ) then
      raise exception 'not_a_participant'
        using errcode = '42501';
    end if;


    /*
     * Presence is updated only for active rooms.
     */
    if p_action in (
      'status',
      'heartbeat',
      'reconnect',
      'start'
    ) then

      if v_match.status in ('waiting', 'playing') then
        update okey.match_seats
        set
          connected = true,
          last_seen_at = now()
        where match_id = v_match.id
          and user_id = p_user_id;
      end if;


    elsif p_action = 'leave' then

      /*
       * Before the game begins, leaving removes the seat.
       */
      if v_match.status = 'waiting' then

        delete from okey.match_seats
        where match_id = v_match.id
          and user_id = p_user_id;

        update okey.matches
        set
          countdown_deadline_at = null,
          updated_at = now()
        where id = v_match.id
        returning *
        into v_match;


      /*
       * During a match, the seat remains and the player becomes disconnected.
       * Maintenance may later hand the seat to a Bot.
       */
      elsif v_match.status = 'playing' then

        update okey.match_seats
        set
          connected = false,
          last_seen_at = now()
        where match_id = v_match.id
          and user_id = p_user_id;

      end if;

    end if;


  else
    raise exception 'invalid_action'
      using errcode = '22023';
  end if;


  -- ==========================================================================
  -- Refresh and lock current match
  -- ==========================================================================

  select match.*
  into v_match
  from okey.matches match
  where match.id = coalesce(
    p_match_id,
    v_match.id
  )
  for update;


  if not found then
    raise exception 'match_not_found'
      using errcode = 'P0002';
  end if;


  -- ==========================================================================
  -- Presence expiration
  -- ==========================================================================

  if v_match.status in ('waiting', 'playing') then
    update okey.match_seats
    set connected = false
    where match_id = v_match.id
      and connected = true
      and last_seen_at <
        now() - interval '4 seconds';
  end if;


  -- ==========================================================================
  -- Count room members and presence
  -- ==========================================================================

  select
    count(*),

    count(*) filter (
      where connected = true
    ),

    count(*) filter (
      where connected = true
        and v_match.countdown_deadline_at is not null
        and last_seen_at >=
          v_match.countdown_deadline_at
    )
  into
    v_member_count,
    v_connected_count,
    v_confirmed_count
  from okey.match_seats
  where match_id = v_match.id;


  -- ==========================================================================
  -- Waiting-room countdown
  -- ==========================================================================

  if v_match.status = 'waiting' then

    /*
     * Begin the countdown when all four seats exist and are connected.
     */
    if v_member_count = 4
       and v_connected_count = 4 then

      if v_match.countdown_deadline_at is null then
        update okey.matches
        set
          countdown_deadline_at =
            now() + interval '5 seconds',
          updated_at = now()
        where id = v_match.id
        returning *
        into v_match;
      end if;


    /*
     * Cancel the countdown when anyone disconnects or leaves.
     */
    elsif v_match.countdown_deadline_at is not null then

      update okey.matches
      set
        countdown_deadline_at = null,
        updated_at = now()
      where id = v_match.id
      returning *
      into v_match;

      v_confirmed_count := 0;

    end if;

  end if;


  -- ==========================================================================
  -- Authoritative start
  -- ==========================================================================

  if p_action = 'start' then

    /*
     * Recalculate confirmation after the start caller's heartbeat update.
     */
    select
      count(*),
      count(*) filter (
        where connected = true
      ),
      count(*) filter (
        where connected = true
          and v_match.countdown_deadline_at is not null
          and last_seen_at >=
            v_match.countdown_deadline_at
      )
    into
      v_member_count,
      v_connected_count,
      v_confirmed_count
    from okey.match_seats
    where match_id = v_match.id;


    if v_match.status <> 'waiting'
       or v_member_count <> 4
       or v_connected_count <> 4
       or v_confirmed_count <> 4
       or v_match.countdown_deadline_at is null
       or v_match.countdown_deadline_at > now() then

      raise exception 'countdown_not_complete'
        using errcode = 'P0001';
    end if;


    if p_state is null
       or p_projection is null
       or p_turn_deadline_at is null then

      raise exception 'initial_state_required'
        using errcode = '22023';
    end if;


    /*
     * Only the first successful start may insert the private state.
     */
    insert into okey.match_private_states (
      match_id,
      state
    )
    values (
      v_match.id,
      p_state
    )
    on conflict (match_id)
    do nothing;


    if not found then
      raise exception 'match_already_started'
        using errcode = 'P0001';
    end if;


    update okey.matches
    set
      status = 'playing',
      version = 0,
      public_projection = p_projection,
      turn_deadline_at = p_turn_deadline_at,
      countdown_deadline_at = null,
      updated_at = now()
    where id = v_match.id
      and status = 'waiting'
    returning *
    into v_match;


    if not found then
      raise exception 'match_already_started'
        using errcode = 'P0001';
    end if;


  -- ==========================================================================
  -- Cancel an empty waiting room
  -- ==========================================================================

  elsif p_action = 'leave'
        and v_match.status = 'waiting'
        and v_member_count = 0 then

    update okey.matches
    set
      status = 'cancelled',
      countdown_deadline_at = null,
      updated_at = now()
    where id = v_match.id
    returning *
    into v_match;

  end if;


  -- ==========================================================================
  -- Final room snapshot
  -- ==========================================================================

  select
    count(*),

    count(*) filter (
      where connected = true
    ),

    count(*) filter (
      where connected = true
        and v_match.countdown_deadline_at is not null
        and last_seen_at >=
          v_match.countdown_deadline_at
    )
  into
    v_member_count,
    v_connected_count,
    v_confirmed_count
  from okey.match_seats
  where match_id = v_match.id;


  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'userId', user_id,
        'playerIndex', player_index,
        'teamId', team_id,
        'displayName', display_name,
        'avatarUrl', avatar_url,
        'connected', connected
      )
      order by player_index
    ),
    '[]'::jsonb
  )
  into v_members
  from okey.match_seats
  where match_id = v_match.id;


  return jsonb_build_object(
    'matchId', v_match.id,
    'roomCode', v_match.room_code,
    'tableId', v_match.table_id,
    'status', v_match.status,
    'version', v_match.version,

    'memberCount', v_member_count,
    'connectedCount', v_connected_count,
    'confirmedCount', v_confirmed_count,

    'countdownEndsAt',
      v_match.countdown_deadline_at,

    'shouldStart',
      v_match.status = 'waiting'
      and v_member_count = 4
      and v_connected_count = 4
      and v_confirmed_count = 4
      and v_match.countdown_deadline_at
        is not null
      and v_match.countdown_deadline_at
        <= now(),

    'members', v_members
  );
end;
$$;


-- ============================================================================
-- 3. Permissions
-- ============================================================================

revoke all on function public.okey_room_action(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb,
  timestamptz
)
from public, anon, authenticated;


grant execute on function public.okey_room_action(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb,
  timestamptz
)
to service_role;