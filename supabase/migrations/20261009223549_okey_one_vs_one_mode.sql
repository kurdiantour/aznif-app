-- Okey 1v1 shares the authoritative engine, room, wallet and lifecycle RPCs.
alter table okey.matches add column if not exists mode text not null default '2v2'
  check (mode in ('1v1', '2v2'));
create index if not exists okey_waiting_mode_matchmaking_idx
  on okey.matches(mode, table_id, created_at) where status = 'waiting';


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
  v_capacity integer;

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

  if trim(p_table_id) not in (
    'fun:1v1',
    'fun:2v2',
    'aznif:1v1',
    'aznif:2v2'
  ) then
    raise exception 'unknown_table'
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
       * Find the oldest waiting room with available seats for its mode.
       */
      select match.*
      into v_match
      from okey.matches match
      where match.status = 'waiting'
        and match.table_id = trim(p_table_id)
        and match.mode = case when trim(p_table_id) in ('fun:1v1', 'aznif:1v1') then '1v1' else '2v2' end
        and (
          select count(*)
          from okey.match_seats seat
          where seat.match_id = match.id
        ) < case when trim(p_table_id) in ('fun:1v1', 'aznif:1v1') then 2 else 4 end
      order by match.created_at
      limit 1
      for update;


      /*
       * Create a new waiting room when no suitable room exists.
       */
      if not found then
        insert into okey.matches (
          status,
          mode,
          table_id,
          created_by,
          room_code,
          countdown_deadline_at
        )
        values (
          'waiting',
          case when trim(p_table_id) in ('fun:1v1', 'aznif:1v1') then '1v1' else '2v2' end,
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
      from generate_series(0, case when v_match.mode = '1v1' then 1 else 3 end) candidate
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

  v_capacity := case when v_match.mode = '1v1' then 2 else 4 end;
  if v_match.status = 'waiting' then

    /*
     * Begin the countdown when all four seats exist and are connected.
     */
    if v_member_count = v_capacity
       and v_connected_count = v_capacity then

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
       or v_member_count <> v_capacity
       or v_connected_count <> v_capacity
       or v_confirmed_count <> v_capacity
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
    'mode', v_match.mode,
    'capacity', v_capacity,
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
      and v_member_count = v_capacity
      and v_connected_count = v_capacity
      and v_confirmed_count = v_capacity
      and v_match.countdown_deadline_at
        is not null
      and v_match.countdown_deadline_at
        <= now(),

    'members', v_members
  );
end;
$$;

create or replace function public.okey_configure_match(
  p_match_id uuid,
  p_entry_fee numeric,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_currency text;
  v_commission_rate numeric(6,5);
  v_entry_fee numeric(20,2);
  v_commission_per_player numeric(20,2);
  v_total_entry numeric(20,2);
  v_total_commission numeric(20,2);
  v_prize_pool numeric(20,2);
  v_capacity integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required'
      using errcode = '22023';
  end if;

  if p_entry_fee is null or p_entry_fee < 0 then
    raise exception 'invalid_entry_fee'
      using errcode = '22023';
  end if;

  v_currency := lower(trim(coalesce(p_currency, '')));

  if v_currency not in ('fun', 'aznif') then
    raise exception 'invalid_match_currency'
      using errcode = '22023';
  end if;

  select case when mode = '1v1' then 2 else 4 end into v_capacity
  from okey.matches where id = p_match_id and status = 'waiting';
  if v_capacity is null then raise exception 'match_not_waiting'; end if;
  v_entry_fee := round(p_entry_fee::numeric, 2);

  v_commission_rate :=
    case
      when v_currency = 'aznif' then 0.05::numeric
      else 0::numeric
    end;

  v_commission_per_player :=
    round(v_entry_fee * v_commission_rate, 2);

  v_total_entry :=
    round(v_entry_fee * v_capacity, 2);

  v_total_commission :=
    round(v_commission_per_player * v_capacity, 2);

  v_prize_pool :=
    round(v_total_entry - v_total_commission, 2);

  update okey.matches
  set
    entry_fee = v_entry_fee,
    currency = v_currency,
    commission_rate = v_commission_rate,
    commission_per_player = v_commission_per_player,
    total_entry = v_total_entry,
    total_commission = v_total_commission,
    prize_pool = v_prize_pool,
    updated_at = now()
  where id = p_match_id
    and status = 'waiting'
    and settlement_at is null;

  if not found then
    raise exception 'match_not_waiting'
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.okey_charge_entry_fee(
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_match okey.matches%rowtype;
  v_seat okey.match_seats%rowtype;

  v_seat_count integer;
  v_distinct_user_count integer;
  v_capacity integer;

  v_balance_before numeric(20,2);
  v_balance_after numeric(20,2);
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required'
      using errcode = '22023';
  end if;

  select *
  into v_match
  from okey.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found'
      using errcode = 'P0002';
  end if;

  v_capacity := case when v_match.mode = '1v1' then 2 else 4 end;
  if v_match.status <> 'waiting' then
    raise exception 'match_not_waiting'
      using errcode = 'P0001';
  end if;

  if v_match.entry_fee = 0 then
    return jsonb_build_object(
      'charged', false,
      'reason', 'free_match',
      'currency', v_match.currency,
      'entryFeePerPlayer', 0,
      'commissionRate', v_match.commission_rate,
      'commissionPerPlayer', 0,
      'totalEntry', 0,
      'totalCommission', 0,
      'prizePool', 0
    );
  end if;

  if exists (
    select 1
    from okey.wallet_ledger
    where match_id = p_match_id
      and reason = 'entry_fee'
  ) then
    return jsonb_build_object(
      'charged', false,
      'reason', 'already_charged',
      'currency', v_match.currency,
      'entryFeePerPlayer', v_match.entry_fee,
      'commissionRate', v_match.commission_rate,
      'commissionPerPlayer', v_match.commission_per_player,
      'totalEntry', v_match.total_entry,
      'totalCommission', v_match.total_commission,
      'prizePool', v_match.prize_pool
    );
  end if;

  -- Defensive validation: fun must never contain commission.
  if v_match.currency = 'fun'
     and (
       v_match.commission_rate <> 0
       or v_match.commission_per_player <> 0
       or v_match.total_commission <> 0
       or v_match.prize_pool <> v_match.total_entry
     ) then
    raise exception 'invalid_fun_economy_configuration'
      using errcode = 'P0001';
  end if;

  -- Defensive validation: Aznif uses the configured 5% model.
  if v_match.currency = 'aznif'
     and v_match.commission_rate <> 0.05 then
    raise exception 'invalid_aznif_commission_rate'
      using errcode = 'P0001';
  end if;

  select
    count(*),
    count(distinct user_id)
  into
    v_seat_count,
    v_distinct_user_count
  from okey.match_seats
  where match_id = p_match_id;

  if v_seat_count <> v_capacity
     or v_distinct_user_count <> v_capacity then
    raise exception 'match_requires_four_unique_players'
      using errcode = 'P0001';
  end if;

  for v_seat in
    select *
    from okey.match_seats
    where match_id = p_match_id
    order by player_index
  loop
    if v_seat.user_id is null then
      raise exception 'seat_missing_user'
        using errcode = 'P0001';
    end if;

    if v_match.currency = 'aznif' then
      select mc
      into v_balance_before
      from public.wallets
      where user_id = v_seat.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized'
          using errcode = 'P0001';
      end if;

      if v_balance_before < v_match.entry_fee then
        raise exception 'insufficient_entry_balance'
          using errcode = 'P0001';
      end if;

      update public.wallets
      set
        mc = mc - v_match.entry_fee,
        updated_at = now()
      where user_id = v_seat.user_id
      returning mc
      into v_balance_after;

    elsif v_match.currency = 'fun' then
      select coin
      into v_balance_before
      from public.wallets
      where user_id = v_seat.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized'
          using errcode = 'P0001';
      end if;

      if v_balance_before < v_match.entry_fee then
        raise exception 'insufficient_entry_balance'
          using errcode = 'P0001';
      end if;

      update public.wallets
      set
        coin = coin - v_match.entry_fee,
        updated_at = now()
      where user_id = v_seat.user_id
      returning coin
      into v_balance_after;

    else
      raise exception 'invalid_match_currency'
        using errcode = '22023';
    end if;

    insert into okey.wallet_ledger (
      user_id,
      match_id,
      currency,
      amount,
      reason,
      idempotency_key,
      metadata
    )
    values (
      v_seat.user_id,
      p_match_id,
      v_match.currency,
      -v_match.entry_fee,
      'entry_fee',
      p_match_id::text
        || ':entry:'
        || v_seat.user_id::text,
      jsonb_build_object(
        'playerIndex', v_seat.player_index,
        'teamId', v_seat.team_id,
        'balanceBefore', v_balance_before,
        'balanceAfter', v_balance_after,
        'entryFee', v_match.entry_fee,
        'commissionPart', v_match.commission_per_player,
        'prizePoolPart',
          round(
            v_match.entry_fee - v_match.commission_per_player,
            2
          )
      )
    );
  end loop;

  -- Audit-only burn record.
  -- It exists only for Aznif and credits no wallet.
  if v_match.currency = 'aznif'
     and v_match.total_commission > 0 then
    insert into okey.wallet_ledger (
      user_id,
      match_id,
      currency,
      amount,
      reason,
      idempotency_key,
      metadata
    )
    values (
      null,
      p_match_id,
      'aznif',
      v_match.total_commission,
      'house_commission',
      p_match_id::text || ':commission-burn',
      jsonb_build_object(
        'event', 'commission_burn',
        'burned', true,
        'creditedToWallet', false,
        'destination', 'none',
        'commissionRate', v_match.commission_rate,
        'commissionPerPlayer', v_match.commission_per_player,
        'playerCount', v_capacity,
        'totalCommission', v_match.total_commission
      )
    );
  end if;

  return jsonb_build_object(
    'charged', true,
    'currency', v_match.currency,
    'entryFeePerPlayer', v_match.entry_fee,
    'commissionRate', v_match.commission_rate,
    'commissionPerPlayer', v_match.commission_per_player,
    'totalEntry', v_match.total_entry,
    'totalCommission', v_match.total_commission,
    'prizePool', v_match.prize_pool,
    'commissionBurned',
      v_match.currency = 'aznif'
      and v_match.total_commission > 0
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.okey_settle_match(
  p_match_id uuid,
  p_winner_team_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, okey
AS $$
DECLARE
  v_match okey.matches%rowtype;
  v_seat okey.match_seats%rowtype;
  v_manual_left_player_ids jsonb := '[]'::jsonb;
  v_charged_players integer;
  v_remaining_humans integer;
  v_eligible_winners integer;
  v_capacity integer;
  v_winner_count integer;
  v_payout_per_winner numeric(20,2);
  v_balance_before numeric(20,2);
  v_balance_after numeric(20,2);
  v_result jsonb;
  v_is_bot boolean;
BEGIN
  IF auth.role() <> 'service_role' then
    RAISE EXCEPTION 'service_role_required' USING errcode = '42501';
  END IF;

  IF p_match_id is null then
    RAISE EXCEPTION 'match_id_required' USING errcode = '22023';
  END IF;

  SELECT *
  INTO v_match
  from okey.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found' USING errcode = 'P0002';
  END IF;

  v_capacity := case when v_match.mode = '1v1' then 2 else 4 end;
  v_winner_count := v_capacity / 2;
  IF v_match.settlement_at is not null then
    IF coalesce(v_match.settlement->>'type', '') in ('winner', 'no_winner') then
      RETURN coalesce(v_match.settlement, '{}'::jsonb);
    END IF;
    RAISE EXCEPTION 'match_already_settled' USING errcode = 'P0001';
  END IF;

  SELECT coalesce(state->'manualLeftPlayerIds', '[]'::jsonb)
  INTO v_manual_left_player_ids
  from okey.match_private_states
  WHERE match_id = p_match_id;

  v_manual_left_player_ids := coalesce(v_manual_left_player_ids, '[]'::jsonb);

  SELECT count(*)
  INTO v_charged_players
  from okey.wallet_ledger
  WHERE match_id = p_match_id
    and reason = 'entry_fee';

  IF v_match.entry_fee > 0 and v_charged_players <> v_capacity then
    RAISE EXCEPTION 'entry_fee_not_fully_charged' USING errcode = 'P0001';
  END IF;

  -- Treat anyone controlledByBot as non-human for eligibility
  SELECT count(*)
  INTO v_remaining_humans
  from okey.match_seats seat
  WHERE seat.match_id = p_match_id
    and not EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(
        (SELECT state->'players' from okey.match_private_states WHERE match_id = p_match_id)
      ) AS p(id uuid, controlledByBot boolean, kind text)
      WHERE p.id = seat.user_id AND (coalesce(p.controlledByBot, false) OR p.kind = 'bot')
    );

  IF p_winner_team_id is null then
    IF v_remaining_humans <> 0 then
      RAISE EXCEPTION 'no_winner_requires_zero_humans' USING errcode = 'P0001';
    END IF;

    v_result := jsonb_build_object(
      'type', 'no_winner',
      'currency', v_match.currency,
      'entryFeePerPlayer', v_match.entry_fee,
      'totalEntry', v_match.total_entry,
      'totalCommission', v_match.total_commission,
      'prizePool', v_match.prize_pool,
      'payoutPerWinner', 0,
      'eligibleWinnerCount', 0,
      'refundPerPlayer', 0,
      'refundedPlayers', 0,
      'manualLeftPlayerIds', v_manual_left_player_ids
    );

    UPDATE okey.matches
    SET status = 'finished',
        turn_deadline_at = null,
        settlement_at = now(),
        settlement = v_result,
        updated_at = now()
    WHERE id = p_match_id;

    RETURN v_result;
  END IF;

  IF p_winner_team_id not in ('teamA', 'teamB') then
    RAISE EXCEPTION 'invalid_winner_team' USING errcode = '22023';
  END IF;

  IF v_match.currency = 'fun'
     and (v_match.total_commission <> 0 or v_match.prize_pool <> v_match.total_entry) then
    RAISE EXCEPTION 'invalid_fun_economy_configuration' USING errcode = 'P0001';
  END IF;

  v_payout_per_winner := round(v_match.prize_pool / v_winner_count, 2);
  IF round(v_payout_per_winner * v_winner_count, 2) <> v_match.prize_pool then
    RAISE EXCEPTION 'prize_pool_not_evenly_divisible' USING errcode = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_eligible_winners
  from okey.match_seats seat
  WHERE seat.match_id = p_match_id
    and seat.team_id = p_winner_team_id
    and not EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(
        (SELECT state->'players' from okey.match_private_states WHERE match_id = p_match_id)
      ) AS p(id uuid, controlledByBot boolean, kind text)
      WHERE p.id = seat.user_id AND (coalesce(p.controlledByBot, false) OR p.kind = 'bot')
    );

  FOR v_seat in
    SELECT *
    from okey.match_seats seat
    WHERE seat.match_id = p_match_id
      and seat.team_id = p_winner_team_id
    ORDER BY seat.player_index
  LOOP
    -- Check if player is bot-controlled
    SELECT coalesce(p.controlledByBot, false) OR (p.kind = 'bot') INTO v_is_bot
    FROM jsonb_to_recordset(
      (SELECT state->'players' from okey.match_private_states WHERE match_id = p_match_id)
    ) AS p(id uuid, controlledByBot boolean, kind text)
    WHERE p.id = v_seat.user_id;

    v_is_bot := coalesce(v_is_bot, false);

    IF NOT v_is_bot THEN
      IF v_match.currency = 'aznif' then
        SELECT mc INTO v_balance_before
        from public.wallets
        WHERE user_id = v_seat.user_id
        FOR UPDATE;

        IF not FOUND then
          RAISE EXCEPTION 'wallet_not_initialized' USING errcode = 'P0001';
        END IF;

        UPDATE public.wallets
        SET mc = mc + v_payout_per_winner, updated_at = now()
        WHERE user_id = v_seat.user_id
        RETURNING mc INTO v_balance_after;
      elsif v_match.currency = 'fun' then
        SELECT coin into v_balance_before
        from public.wallets
        WHERE user_id = v_seat.user_id
        FOR UPDATE;

        IF not FOUND then
          RAISE EXCEPTION 'wallet_not_initialized' USING errcode = 'P0001';
        END IF;

        UPDATE public.wallets
        SET coin = coin + v_payout_per_winner, updated_at = now()
        WHERE user_id = v_seat.user_id
        RETURNING coin into v_balance_after;
      else
        RAISE EXCEPTION 'invalid_match_currency' USING errcode = '22023';
      END IF;

      INSERT INTO okey.wallet_ledger (
        user_id, match_id, currency, amount, reason, idempotency_key, metadata
      )
      VALUES (
        v_seat.user_id,
        p_match_id,
        v_match.currency,
        v_payout_per_winner,
        'prize',
        p_match_id::text || ':prize:' || p_winner_team_id || ':' || v_seat.user_id::text,
        jsonb_build_object(
          'winnerTeamId', p_winner_team_id,
          'balanceBefore', v_balance_before,
          'balanceAfter', v_balance_after,
          'payout', v_payout_per_winner,
          'manualLeaveEligible', true
        )
      );
    ELSE
      -- Bot takeover: Burn the payout and log in ledger as house_commission to balance with entries.
      IF v_match.currency = 'aznif' AND v_payout_per_winner > 0 THEN
        INSERT INTO okey.wallet_ledger (
          user_id,
          match_id,
          currency,
          amount,
          reason,
          idempotency_key,
          metadata
        )
        VALUES (
          NULL,
          p_match_id,
          v_match.currency,
          v_payout_per_winner,
          'house_commission',
          p_match_id::text || ':takeover-prize-burn:' || v_seat.user_id::text,
          jsonb_build_object(
            'event', 'takeover_prize_burn',
            'burned', true,
            'target_player_id', v_seat.user_id,
            'payout', v_payout_per_winner
          )
        );
      END IF;
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'type', 'winner',
    'currency', v_match.currency,
    'winnerTeamId', p_winner_team_id,
    'entryFeePerPlayer', v_match.entry_fee,
    'commissionRate', v_match.commission_rate,
    'commissionPerPlayer', v_match.commission_per_player,
    'totalEntry', v_match.total_entry,
    'totalCommission', v_match.total_commission,
    'commissionBurned', v_match.currency = 'aznif' and v_match.total_commission > 0,
    'prizePool', v_match.prize_pool,
    'payoutPerWinner', v_payout_per_winner,
    'eligibleWinnerCount', v_eligible_winners,
    'manualLeftPlayerIds', v_manual_left_player_ids
  );

  UPDATE okey.matches
  SET status = 'finished',
      turn_deadline_at = null,
      settlement_at = now(),
      settlement = v_result,
      updated_at = now()
  WHERE id = p_match_id;

  RETURN v_result;
END;
$$;

create or replace function public.okey_cancel_match_and_refund(
  p_match_id uuid,
  p_cancel_reason text default 'match_cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_match okey.matches%rowtype;
  v_entry record;

  v_charged_players integer := 0;
  v_refunded_players integer := 0;

  v_refund_amount numeric(20,2);
  v_balance_before numeric(20,2);
  v_balance_after numeric(20,2);

  v_cancel_reason text;
  v_result jsonb;
begin
  -- --------------------------------------------------------------------------
  -- Security and input validation
  -- --------------------------------------------------------------------------

  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required'
      using errcode = '22023';
  end if;

  v_cancel_reason :=
    left(
      coalesce(
        nullif(trim(p_cancel_reason), ''),
        'match_cancelled'
      ),
      200
    );


  -- --------------------------------------------------------------------------
  -- Lock match and protect settlement idempotency
  -- --------------------------------------------------------------------------

  select *
  into v_match
  from okey.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found'
      using errcode = 'P0002';
  end if;

  if v_match.settlement_at is not null then
    if coalesce(v_match.settlement->>'type', '') = 'refund' then
      return coalesce(v_match.settlement, '{}'::jsonb);
    end if;

    raise exception 'match_already_settled'
      using errcode = 'P0001';
  end if;

  if v_match.status not in ('waiting', 'playing') then
    raise exception 'match_not_cancellable'
      using errcode = 'P0001';
  end if;


  -- --------------------------------------------------------------------------
  -- Validate charged entry-fee records
  -- --------------------------------------------------------------------------

  select count(*)
  into v_charged_players
  from okey.wallet_ledger
  where match_id = p_match_id
    and reason = 'entry_fee';

  if v_match.entry_fee > 0
     and v_charged_players <> (case when v_match.mode = '1v1' then 2 else 4 end) then
    raise exception 'entry_fee_not_fully_charged'
      using errcode = 'P0001';
  end if;

  if v_match.entry_fee = 0
     and v_charged_players <> 0 then
    raise exception 'unexpected_entry_fee_records'
      using errcode = 'P0001';
  end if;


  -- --------------------------------------------------------------------------
  -- Full refund
  --
  -- Refund from ledger records rather than current seats so the exact users
  -- originally charged are refunded even if room presence later changed.
  -- --------------------------------------------------------------------------

  for v_entry in
    select
      ledger.user_id,
      ledger.amount,
      ledger.metadata
    from okey.wallet_ledger ledger
    where ledger.match_id = p_match_id
      and ledger.reason = 'entry_fee'
    order by ledger.created_at, ledger.id
  loop
    if v_entry.user_id is null then
      raise exception 'charged_entry_missing_user'
        using errcode = 'P0001';
    end if;

    v_refund_amount := round(abs(v_entry.amount), 2);

    if v_refund_amount <= 0 then
      raise exception 'invalid_charged_entry_amount'
        using errcode = 'P0001';
    end if;


    -- ------------------------------------------------------------------------
    -- Aznif / MC
    -- ------------------------------------------------------------------------

    if v_match.currency = 'aznif' then
      select mc
      into v_balance_before
      from public.wallets
      where user_id = v_entry.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized'
          using errcode = 'P0001';
      end if;

      update public.wallets
      set
        mc = mc + v_refund_amount,
        updated_at = now()
      where user_id = v_entry.user_id
      returning mc
      into v_balance_after;


    -- ------------------------------------------------------------------------
    -- Fun / Coin
    -- ------------------------------------------------------------------------

    elsif v_match.currency = 'fun' then
      select coin
      into v_balance_before
      from public.wallets
      where user_id = v_entry.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized'
          using errcode = 'P0001';
      end if;

      update public.wallets
      set
        coin = coin + v_refund_amount,
        updated_at = now()
      where user_id = v_entry.user_id
      returning coin
      into v_balance_after;

    else
      raise exception 'invalid_match_currency'
        using errcode = 'P0001';
    end if;


    insert into okey.wallet_ledger (
      user_id,
      match_id,
      currency,
      amount,
      reason,
      idempotency_key,
      metadata
    )
    values (
      v_entry.user_id,
      p_match_id,
      v_match.currency,
      v_refund_amount,
      'refund',
      p_match_id::text
        || ':refund:'
        || v_entry.user_id::text,
      jsonb_build_object(
        'balanceBefore', v_balance_before,
        'balanceAfter', v_balance_after,
        'refundAmount', v_refund_amount,
        'reason', v_cancel_reason,
        'source', 'cancellation_full_refund'
      )
    );

    v_refunded_players := v_refunded_players + 1;
  end loop;


  -- --------------------------------------------------------------------------
  -- Reverse Aznif commission burn in audit
  --
  -- No treasury wallet exists. The negative audit entry records that the
  -- previously burned commission is undone because the full entries returned.
  -- Fun never enters this branch.
  -- --------------------------------------------------------------------------

  if v_match.currency = 'aznif'
     and v_match.total_commission > 0
     and exists (
       select 1
       from okey.wallet_ledger ledger
       where ledger.match_id = p_match_id
         and ledger.reason = 'house_commission'
         and ledger.amount > 0
     ) then

    insert into okey.wallet_ledger (
      user_id,
      match_id,
      currency,
      amount,
      reason,
      idempotency_key,
      metadata
    )
    values (
      null,
      p_match_id,
      'aznif',
      -v_match.total_commission,
      'house_commission',
      p_match_id::text || ':commission-burn-reversal',
      jsonb_build_object(
        'reversal', true,
        'burned', false,
        'reason', v_cancel_reason,
        'totalCommission', v_match.total_commission,
        'source', 'cancellation_full_refund'
      )
    );
  end if;


  -- --------------------------------------------------------------------------
  -- Finalize cancellation
  -- --------------------------------------------------------------------------

  v_result := jsonb_build_object(
    'type', 'refund',
    'currency', v_match.currency,
    'reason', v_cancel_reason,
    'refundPerPlayer', v_match.entry_fee,
    'refundedPlayers', v_refunded_players,
    'totalRefund',
      case
        when v_match.entry_fee = 0 then 0
        else round(v_match.entry_fee * v_refunded_players, 2)
      end,
    'commissionReversed',
      case
        when v_match.currency = 'aznif'
          then v_match.total_commission
        else 0
      end
  );

  update okey.matches
  set
    status = 'cancelled',
    turn_deadline_at = null,
    countdown_deadline_at = null,
    settlement_at = now(),
    settlement = v_result,
    updated_at = now()
  where id = p_match_id;

  return v_result;
end;
$$;

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
  v_capacity integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select countdown_deadline_at, case when mode = '1v1' then 2 else 4 end
  into v_deadline, v_capacity
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

  if v_member_count <> v_capacity or v_connected_count <> v_capacity then
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


revoke all on function public.okey_room_action(uuid,text,uuid,text,text,text,jsonb,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.okey_room_action(uuid,text,uuid,text,text,text,jsonb,jsonb,timestamptz) to service_role;
revoke all on function public.okey_configure_match(uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.okey_configure_match(uuid,numeric,text) to service_role;
revoke all on function public.okey_charge_entry_fee(uuid) from public, anon, authenticated;
grant execute on function public.okey_charge_entry_fee(uuid) to service_role;
revoke all on function public.okey_settle_match(uuid,text) from public, anon, authenticated;
grant execute on function public.okey_settle_match(uuid,text) to service_role;
revoke all on function public.okey_cancel_match_and_refund(uuid,text) from public, anon, authenticated;
grant execute on function public.okey_cancel_match_and_refund(uuid,text) to service_role;
revoke all on function public.okey_confirm_server_countdown(uuid) from public, anon, authenticated;
grant execute on function public.okey_confirm_server_countdown(uuid) to service_role;
