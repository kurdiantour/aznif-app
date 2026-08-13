-- Separate gameplay control, resumable membership, and intentional leave.
alter table okey.match_seats
  add column if not exists membership_released_at timestamptz,
  add column if not exists membership_release_reason text;

alter table okey.match_seats
  drop constraint if exists okey_match_seats_membership_release_reason_check;
alter table okey.match_seats
  add constraint okey_match_seats_membership_release_reason_check
  check (
    (membership_released_at is null and membership_release_reason is null)
    or
    (membership_released_at is not null and membership_release_reason in ('bot_takeover', 'manual_leave'))
  );

create index if not exists okey_match_seats_active_membership_idx
  on okey.match_seats(user_id, match_id)
  where membership_released_at is null;

create or replace function public.get_active_okey_memberships(p_user_id uuid)
returns table (match_id uuid, player_index integer, status text)
language plpgsql security definer
set search_path = pg_catalog, public, okey
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  return query
  select seat.match_id, seat.player_index::integer, match.status::text
  from okey.match_seats seat
  join okey.matches match on match.id = seat.match_id
  where seat.user_id = p_user_id
    and seat.membership_released_at is null
    and match.status in ('waiting', 'playing');
end;
$$;
revoke all on function public.get_active_okey_memberships(uuid) from public, anon, authenticated;
grant execute on function public.get_active_okey_memberships(uuid) to service_role;

create or replace function public.okey_get_authoritative_bundle(
  p_match_id uuid, p_user_id uuid, p_command_id uuid default null
)
returns table (
  version bigint, status text, turn_deadline_at timestamptz,
  player_index smallint, state jsonb, command_applied boolean
)
language plpgsql security definer
set search_path = pg_catalog, public, okey
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_match_id is null then
    raise exception 'match_id_required' using errcode = '22023';
  end if;
  if p_user_id is null then
    raise exception 'user_id_required' using errcode = '22023';
  end if;

  return query
  select match.version, match.status, match.turn_deadline_at,
    seat.player_index, private_state.state,
    case when p_command_id is null then false else exists (
      select 1 from okey.match_commands command
      where command.match_id = match.id and command.command_id = p_command_id
    ) end
  from okey.matches match
  join okey.match_seats seat
    on seat.match_id = match.id and seat.user_id = p_user_id
  join okey.match_private_states private_state on private_state.match_id = match.id
  where match.id = p_match_id
    and (
      seat.membership_released_at is null
      or exists (
        select 1 from okey.match_commands command
        where command.match_id = match.id
          and command.command_id = p_command_id
          and command.user_id = p_user_id
      )
    );
end;
$$;
revoke all on function public.okey_get_authoritative_bundle(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.okey_get_authoritative_bundle(uuid, uuid, uuid) to service_role;

create or replace function public.okey_commit_authoritative_command_with_events(
  p_match_id uuid, p_user_id uuid, p_command_id uuid,
  p_expected_version bigint, p_command_type text, p_state jsonb,
  p_projection jsonb, p_status text, p_turn_deadline_at timestamptz,
  p_gameplay_events jsonb
)
returns table (applied boolean, version bigint, state jsonb, turn_deadline_at timestamptz)
language plpgsql security definer
set search_path = public, okey, pg_temp
as $$
declare
  v_result record;
  v_previous_state jsonb;
  v_seat okey.match_seats%rowtype;
begin
  select private_state.state into v_previous_state
  from okey.match_private_states private_state
  where private_state.match_id = p_match_id;

  select committed.applied, committed.version, committed.state, committed.turn_deadline_at
  into v_result
  from public.okey_commit_authoritative_command(
    p_match_id, p_user_id, p_command_id, p_expected_version,
    p_command_type, p_state, p_projection, p_status, p_turn_deadline_at
  ) committed;

  if v_result.applied then
    if p_command_type = 'manual-leave' then
      update okey.match_seats
      set membership_released_at = coalesce(membership_released_at, clock_timestamp()),
          membership_release_reason = case
            when membership_released_at is null then 'manual_leave'
            else membership_release_reason
          end,
          connected = false
      where match_id = p_match_id and user_id = p_user_id;
    end if;

    for v_seat in
      select * from okey.match_seats where match_id = p_match_id order by player_index
    loop
      if coalesce((v_previous_state #>> array['roundState','players',v_seat.player_index::text,'controlledByBot'])::boolean, false) = false
         and coalesce((p_state #>> array['roundState','players',v_seat.player_index::text,'controlledByBot'])::boolean, false) = true then
        update okey.match_seats
        set membership_released_at = clock_timestamp(),
            membership_release_reason = 'bot_takeover',
            connected = false
        where match_id = p_match_id
          and user_id = v_seat.user_id
          and membership_released_at is null;
      end if;
    end loop;

    perform public.record_authoritative_okey_gameplay_events(
      p_match_id, p_command_id, coalesce(p_gameplay_events, '[]'::jsonb), clock_timestamp()
    );
  end if;

  return query select v_result.applied, v_result.version, v_result.state, v_result.turn_deadline_at;
end;
$$;
revoke all on function public.okey_commit_authoritative_command_with_events(
  uuid,uuid,uuid,bigint,text,jsonb,jsonb,text,timestamptz,jsonb
) from public, anon, authenticated;
grant execute on function public.okey_commit_authoritative_command_with_events(
  uuid,uuid,uuid,bigint,text,jsonb,jsonb,text,timestamptz,jsonb
) to service_role;


-- Matchmaking now ignores released memberships while retaining their seats.
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
    where seat.user_id = p_user_id AND seat.membership_released_at IS NULL
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
        (
          select coalesce(
            raw_user_meta_data->>'display_name',
            raw_user_meta_data->>'full_name',
            raw_user_meta_data->>'name',
            split_part(email, '@', 1)
          )
          from auth.users
          where id = p_user_id
        ),
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
    (
      select coalesce(
        raw_user_meta_data->>'display_name',
        raw_user_meta_data->>'full_name',
        raw_user_meta_data->>'name',
        split_part(email, '@', 1)
      )
      from auth.users
      where id = p_user_id
    ),
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


    if p_action in ('status', 'heartbeat', 'reconnect', 'start') and exists (
      select 1 from okey.match_seats released_seat
      where released_seat.match_id = v_match.id
        and released_seat.user_id = p_user_id
        and released_seat.membership_released_at is not null
    ) then
      raise exception 'membership_released' using errcode = '42501';
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
       * During a match, the seat remains and only its room-presence state is
       * marked disconnected. Authoritative gameplay and Bot control are
       * unaffected by this presence update.
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

  if v_match.status = 'waiting' then
    update okey.match_seats
    set connected = false
    where match_id = v_match.id
      and connected = true
      and last_seen_at <
        now() - interval '150 seconds';
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


-- Party matchmaking uses the same released-membership boundary.
CREATE OR REPLACE FUNCTION public.matchmake_okey_party(
 p_party_id uuid,p_leader_id uuid,p_member_id uuid,p_table_id text,
 p_leader_name text,p_leader_avatar text,p_member_name text,p_member_avatar text,
 p_currency text,p_entry_fee numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,okey AS $$
DECLARE v_match okey.matches%ROWTYPE; v_l okey.match_seats%ROWTYPE; v_m okey.match_seats%ROWTYPE;
 v_first smallint; v_second smallint; v_count integer;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING errcode='42501'; END IF;
 IF p_party_id IS NULL OR p_leader_id IS NULL OR p_member_id IS NULL OR p_leader_id=p_member_id
 OR nullif(trim(p_table_id),'') IS NULL THEN RAISE EXCEPTION 'invalid_party_request' USING errcode='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('okey-party:'||p_party_id::text));
 PERFORM pg_advisory_xact_lock(hashtext('okey-matchmaking:'||trim(p_table_id)));
 PERFORM 1 FROM public.domino_parties p WHERE p.id=p_party_id AND p.status='active' AND p.leader_id=p_leader_id
 AND (SELECT count(*) FROM public.domino_party_members pm WHERE pm.party_id=p.id)=2
 AND EXISTS(SELECT 1 FROM public.domino_party_members pm WHERE pm.party_id=p.id AND pm.user_id=p_leader_id)
 AND EXISTS(SELECT 1 FROM public.domino_party_members pm WHERE pm.party_id=p.id AND pm.user_id=p_member_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'party_not_active' USING errcode='P0001'; END IF;
 SELECT s.* INTO v_l FROM okey.match_seats s JOIN okey.matches m ON m.id=s.match_id
  WHERE s.user_id=p_leader_id AND s.membership_released_at IS NULL AND m.status IN('waiting','playing') ORDER BY m.created_at DESC LIMIT 1 FOR UPDATE OF m,s;
 SELECT s.* INTO v_m FROM okey.match_seats s JOIN okey.matches m ON m.id=s.match_id
  WHERE s.user_id=p_member_id AND s.membership_released_at IS NULL AND m.status IN('waiting','playing') ORDER BY m.created_at DESC LIMIT 1 FOR UPDATE OF m,s;
 IF v_l.match_id IS NOT NULL AND v_m.match_id=v_l.match_id AND v_m.team_id=v_l.team_id THEN
  SELECT * INTO v_match FROM okey.matches WHERE id=v_l.match_id AND status='waiting' AND table_id=trim(p_table_id) FOR UPDATE;
  IF FOUND THEN RETURN v_match.id; END IF;
 END IF;
 IF v_l.match_id IS NOT NULL OR v_m.match_id IS NOT NULL THEN RAISE EXCEPTION 'party_member_already_in_match' USING errcode='P0001'; END IF;
 SELECT m.* INTO v_match FROM okey.matches m WHERE m.status='waiting' AND m.table_id=trim(p_table_id) AND (
  NOT EXISTS(SELECT 1 FROM okey.match_seats s WHERE s.match_id=m.id AND s.player_index IN(0,2)) OR
  NOT EXISTS(SELECT 1 FROM okey.match_seats s WHERE s.match_id=m.id AND s.player_index IN(1,3)))
  ORDER BY m.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN INSERT INTO okey.matches(status,table_id,created_by,room_code,countdown_deadline_at)
  VALUES('waiting',trim(p_table_id),p_leader_id,upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),null) RETURNING * INTO v_match; END IF;
 IF NOT EXISTS(SELECT 1 FROM okey.match_seats WHERE match_id=v_match.id AND player_index IN(0,2)) THEN v_first:=0;v_second:=2;
 ELSIF NOT EXISTS(SELECT 1 FROM okey.match_seats WHERE match_id=v_match.id AND player_index IN(1,3)) THEN v_first:=1;v_second:=3;
 ELSE RAISE EXCEPTION 'party_team_pair_unavailable' USING errcode='P0001'; END IF;
 INSERT INTO okey.match_seats(match_id,user_id,player_index,team_id,display_name,avatar_url,connected,last_seen_at) VALUES
 (v_match.id,p_leader_id,v_first,CASE WHEN v_first=0 THEN 'teamA' ELSE 'teamB' END,left(coalesce(nullif(trim(p_leader_name),''),'Player'),64),p_leader_avatar,true,now()),
 (v_match.id,p_member_id,v_second,CASE WHEN v_second=2 THEN 'teamA' ELSE 'teamB' END,left(coalesce(nullif(trim(p_member_name),''),'Player'),64),p_member_avatar,true,now());
 SELECT count(*) INTO v_count FROM okey.match_seats WHERE match_id=v_match.id;
 UPDATE okey.matches SET countdown_deadline_at=CASE WHEN v_count=4 THEN now()+interval '5 seconds' ELSE null END,updated_at=now() WHERE id=v_match.id;
 UPDATE public.domino_parties SET flow_status='matchmaking',current_game='okey',current_room_id=v_match.id,current_mode='2v2',
 current_currency=p_currency,current_entry_fee=p_entry_fee,current_table_id=trim(p_table_id),command_version=command_version+1,updated_at=now()
 WHERE id=p_party_id AND status='active';
 RETURN v_match.id;
END;$$;
