create or replace function public.okey_preview_test_join_or_create(
  p_user_id uuid,
  p_bot_user_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'okey'
as $function$
declare
  v_match okey.matches%rowtype;
  v_username text;
  v_avatar_url text;
  v_bot1_id uuid;
  v_bot2_id uuid;
  v_member_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'user_required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and is_admin = true
  ) then
    raise exception 'admin_test_access_required'
      using errcode = '42501';
  end if;

  if coalesce(
       array_length(
         p_bot_user_ids,
         1
       ),
       0
     ) <> 2
     or p_bot_user_ids[1] =
        p_bot_user_ids[2]
     or p_user_id =
        any(p_bot_user_ids)
  then
    raise exception 'invalid_test_bot_set'
      using errcode = '22023';
  end if;

  /*
   * Bot IDs باید دقیقاً همان test_bot_accounts
   * slot 1 و slot 2 باشند.
   */
  if exists (
    select 1

    from unnest(
      p_bot_user_ids
    ) with ordinality
      requested(
        user_id,
        slot
      )

    left join
      okey.test_bot_accounts
        configured
      on configured.user_id =
           requested.user_id
     and configured.slot =
           requested.slot

    left join
      auth.users
        bot_user
      on bot_user.id =
           requested.user_id

    where configured.user_id is null
       or bot_user.id is null
       or coalesce(
            (
              bot_user.raw_app_meta_data
              ->>'okey_test_bot'
            )::boolean,
            false
          ) is not true
  ) then
    raise exception 'untrusted_test_bot_account'
      using errcode = '42501';
  end if;

  v_bot1_id :=
    p_bot_user_ids[1];

  v_bot2_id :=
    p_bot_user_ids[2];

  select
    username,
    avatar_url
  into
    v_username,
    v_avatar_url
  from public.profiles
  where id = p_user_id;

  /*
   * اگر همین Admin از قبل عضو Preview
   * Waiting/Playing باشد، همان Match را Resume کن.
   */
  select match.*
  into v_match

  from okey.match_seats seat

  join okey.matches match
    on match.id =
       seat.match_id

  where seat.user_id =
        p_user_id

    and seat.membership_released_at
        is null

    and match.is_test =
        true

    and match.table_id =
        'preview-test'

    and match.status in (
      'waiting',
      'playing'
    )

  order by
    case
      when match.status = 'playing'
        then 0
      else 1
    end,

    match.updated_at desc

  limit 1

  for update of match;

  if found then

    /*
     * هنگام Resume کردن Waiting،
     * Botهای Preview دوباره ready می‌شوند.
     */
    if v_match.status = 'waiting' then

      update okey.match_seats
      set
        connected = true,
        last_seen_at = now()

      where match_id =
            v_match.id

        and player_index
            in (1, 3)

        and bot_since
            is not null

        and membership_released_at
            is null;

    end if;

    select count(*)
    into v_member_count

    from okey.match_seats

    where match_id =
          v_match.id

      and membership_released_at
          is null;

    return jsonb_build_object(
      'matchId',
        v_match.id,

      'status',
        v_match.status,

      'readyToStart',
        v_match.status = 'waiting'
        and v_member_count = 4,

      'resumed',
        true
    );

  end if;

  /*
   * فقط یک transaction در یک لحظه می‌تواند
   * Admin دوم را به Preview Waiting اضافه کند.
   */
  perform pg_advisory_xact_lock(
    hashtext(
      'okey-preview-two-admin-waiting-room'
    )
  );

  /*
   * دنبال Waiting Preview موجود می‌گردیم:
   *
   * seat 0 = Admin 1
   * seat 1 = Bot 1
   * seat 2 = empty
   * seat 3 = Bot 2
   */
  select match.*
  into v_match

  from okey.matches match

  where match.is_test =
        true

    and match.table_id =
        'preview-test'

    and match.status =
        'waiting'

    and not exists (
      select 1

      from okey.match_seats seat

      where seat.match_id =
            match.id

        and seat.user_id =
            p_user_id

        and seat.membership_released_at
            is null
    )

    and exists (
      select 1

      from okey.match_seats seat

      where seat.match_id =
            match.id

        and seat.player_index =
            0

        and seat.bot_since
            is null

        and seat.membership_released_at
            is null
    )

    and not exists (
      select 1

      from okey.match_seats seat

      where seat.match_id =
            match.id

        and seat.player_index =
            2

        and seat.membership_released_at
            is null
    )

  order by
    match.created_at

  limit 1

  for update;

  /*
   * Waiting Match پیدا شد:
   * این Admin می‌شود Player 2.
   */
  if found then

    /*
     * اگر Bot seatها هنوز وجود دارند،
     * نباید متعلق به Botهای دیگری باشند.
     */
    if exists (
      select 1

      from okey.match_seats seat

      where seat.match_id =
            v_match.id

        and seat.player_index
            in (1, 3)

        and seat.user_id
            not in (
              v_bot1_id,
              v_bot2_id
            )

        and seat.membership_released_at
            is null
    ) then

      raise exception
        'preview_bot_set_mismatch'
        using errcode = 'P0001';

    end if;

    /*
     * Admin دوم = seat 2 = teamA
     */
    insert into
      okey.match_seats (
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
      2,
      'teamA',

      coalesce(
        nullif(
          trim(v_username),
          ''
        ),
        'Test Player 2'
      ),

      v_avatar_url,
      true,
      now()
    );

    /*
     * Botها را تضمین و refresh می‌کنیم.
     *
     * seat 1 = Bot 1
     * seat 3 = Bot 2
     */
    insert into
      okey.match_seats (
        match_id,
        user_id,
        player_index,
        team_id,
        display_name,
        avatar_url,
        connected,
        last_seen_at,
        bot_since,
        bot_difficulty
      )

    values
      (
        v_match.id,
        v_bot1_id,
        1,
        'teamB',
        'Test Bot 1',
        null,
        true,
        now(),
        now(),
        'normal'
      ),

      (
        v_match.id,
        v_bot2_id,
        3,
        'teamB',
        'Test Bot 2',
        null,
        true,
        now(),
        now(),
        'normal'
      )

    on conflict (
      match_id,
      player_index
    )

    do update
    set
      user_id =
        excluded.user_id,

      team_id =
        excluded.team_id,

      display_name =
        excluded.display_name,

      avatar_url =
        excluded.avatar_url,

      connected =
        true,

      last_seen_at =
        now(),

      bot_since =
        coalesce(
          okey.match_seats.bot_since,
          now()
        ),

      bot_difficulty =
        'normal',

      membership_released_at =
        null,

      membership_release_reason =
        null;

    update okey.matches
    set
      updated_at = now(),
      countdown_deadline_at = null

    where id =
          v_match.id

    returning *
    into v_match;

    /*
     * چهار Seat آماده‌اند.
     * Edge Function authoritative state را
     * می‌سازد و RPC Start را صدا می‌زند.
     */
    return jsonb_build_object(
      'matchId',
        v_match.id,

      'status',
        'waiting',

      'readyToStart',
        true,

      'resumed',
        false
    );

  end if;

  /*
   * هیچ Waiting Preview وجود ندارد.
   *
   * Admin اول یک Waiting Match جدید می‌سازد.
   */
  insert into
    okey.matches (
      id,
      ruleset_version,
      status,
      version,
      turn_deadline_at,
      public_projection,
      table_id,
      room_code,
      created_by,
      countdown_deadline_at,
      entry_fee,
      currency,
      commission_rate,
      commission_per_player,
      total_entry,
      total_commission,
      prize_pool,
      is_test
    )

  values (
    gen_random_uuid(),
    'okey-v1',
    'waiting',
    0,
    null,
    '{}'::jsonb,
    'preview-test',

    'TEST-' ||
      upper(
        substr(
          gen_random_uuid()::text,
          1,
          8
        )
      ),

    p_user_id,
    null,

    0,
    'fun',
    0,
    0,
    0,
    0,
    0,

    true
  )

  returning *
  into v_match;

  /*
   * Admin اول = seat 0 = teamA
   */
  insert into
    okey.match_seats (
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
    0,
    'teamA',

    coalesce(
      nullif(
        trim(v_username),
        ''
      ),
      'Test Player 1'
    ),

    v_avatar_url,
    true,
    now()
  );

  /*
   * دو Bot از همین لحظه داخل Waiting حاضرند.
   *
   * seat 1 = Bot 1
   * seat 3 = Bot 2
   *
   * seat 2 هنوز خالی است.
   */
  insert into
    okey.match_seats (
      match_id,
      user_id,
      player_index,
      team_id,
      display_name,
      avatar_url,
      connected,
      last_seen_at,
      bot_since,
      bot_difficulty
    )

  values
    (
      v_match.id,
      v_bot1_id,
      1,
      'teamB',
      'Test Bot 1',
      null,
      true,
      now(),
      now(),
      'normal'
    ),

    (
      v_match.id,
      v_bot2_id,
      3,
      'teamB',
      'Test Bot 2',
      null,
      true,
      now(),
      now(),
      'normal'
    );

  return jsonb_build_object(
    'matchId',
      v_match.id,

    'status',
      'waiting',

    'readyToStart',
      false,

    'resumed',
      false
  );

end;
$function$;


create or replace function public.okey_preview_test_start(
  p_actor_user_id uuid,
  p_match_id uuid,
  p_state jsonb,
  p_projection jsonb,
  p_turn_deadline_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'okey'
as $function$
declare
  v_match okey.matches%rowtype;

  v_member_count
    integer := 0;

  v_index
    integer;

  v_seat_user_id
    uuid;

  v_state_player_id
    text;

  v_state_bot_controlled
    boolean;
begin

  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_actor_user_id is null
     or p_match_id is null
     or p_state is null
     or p_projection is null
  then
    raise exception 'invalid_test_match_payload'
      using errcode = '22023';
  end if;

  if not exists (
    select 1

    from public.profiles

    where id =
          p_actor_user_id

      and is_admin =
          true
  ) then

    raise exception 'admin_test_access_required'
      using errcode = '42501';

  end if;

  /*
   * Match را lock می‌کنیم تا فقط یک Start
   * authoritative موفق شود.
   */
  select match.*
  into v_match

  from okey.matches match

  where match.id =
        p_match_id

  for update;

  if not found
     or v_match.is_test is not true
     or v_match.table_id <> 'preview-test'
  then

    raise exception 'test_match_not_found'
      using errcode = 'P0002';

  end if;

  /*
   * Caller باید یکی از دو Admin واقعی همین Match باشد.
   */
  if not exists (
    select 1

    from okey.match_seats seat

    where seat.match_id =
          v_match.id

      and seat.user_id =
          p_actor_user_id

      and seat.membership_released_at
          is null
  ) then

    raise exception 'not_a_participant'
      using errcode = '42501';

  end if;

  /*
   * Idempotent resume.
   */
  if v_match.status = 'playing' then
    return v_match.id;
  end if;

  if v_match.status <> 'waiting' then
    raise exception 'test_match_not_waiting'
      using errcode = 'P0001';
  end if;

  select count(*)
  into v_member_count

  from okey.match_seats seat

  where seat.match_id =
        v_match.id

    and seat.membership_released_at
        is null;

  /*
   * دقیقاً چهار Seat باید وجود داشته باشد.
   */
  if v_member_count <> 4
     or (
       select
         count(
           distinct seat.player_index
         )

       from okey.match_seats seat

       where seat.match_id =
             v_match.id

         and seat.membership_released_at
             is null
     ) <> 4
  then

    raise exception 'test_match_seats_incomplete'
      using errcode = 'P0001';

  end if;

  /*
   * seat 0 و seat 2 باید Admin واقعی باشند.
   */
  if exists (
    select 1

    from okey.match_seats seat

    left join
      public.profiles profile
      on profile.id =
         seat.user_id

    where seat.match_id =
          v_match.id

      and seat.player_index
          in (0, 2)

      and seat.membership_released_at
          is null

      and (
        seat.bot_since
          is not null

        or coalesce(
             profile.is_admin,
             false
           ) is not true
      )
  ) then

    raise exception 'test_human_seat_invalid'
      using errcode = '42501';

  end if;

  /*
   * seat 1 و seat 3 باید Test Bot واقعی باشند.
   */
  if exists (
    select 1

    from okey.match_seats seat

    left join
      okey.test_bot_accounts
        configured
      on configured.user_id =
         seat.user_id

    left join
      auth.users
        bot_user
      on bot_user.id =
         seat.user_id

    where seat.match_id =
          v_match.id

      and seat.player_index
          in (1, 3)

      and seat.membership_released_at
          is null

      and (
        seat.bot_since
          is null

        or configured.user_id
          is null

        or bot_user.id
          is null

        or coalesce(
             (
               bot_user.raw_app_meta_data
               ->>'okey_test_bot'
             )::boolean,
             false
           ) is not true
      )
  ) then

    raise exception 'test_bot_seat_invalid'
      using errcode = '42501';

  end if;

  /*
   * State ساخته‌شده توسط Edge Function باید دقیقاً
   * با Seatهای DB یکی باشد.
   */
  for v_index in 0..3 loop

    select
      seat.user_id
    into
      v_seat_user_id

    from okey.match_seats seat

    where seat.match_id =
          v_match.id

      and seat.player_index =
          v_index

      and seat.membership_released_at
          is null;

    v_state_player_id :=
      p_state #>>
      array[
        'roundState',
        'players',
        v_index::text,
        'id'
      ];

    if v_state_player_id is null
       or v_state_player_id
          <> v_seat_user_id::text
    then

      raise exception 'test_state_seat_mismatch'
        using errcode = '22023';

    end if;

    v_state_bot_controlled :=
      coalesce(
        (
          p_state #>>
          array[
            'roundState',
            'players',
            v_index::text,
            'controlledByBot'
          ]
        )::boolean,
        false
      );

    if (
      v_index in (1, 3)
    ) <> v_state_bot_controlled
    then

      raise exception 'test_state_controller_mismatch'
        using errcode = '22023';

    end if;

  end loop;

  /*
   * Private authoritative state فقط یک بار
   * ایجاد می‌شود.
   */
  insert into
    okey.match_private_states (
      match_id,
      state
    )

  values (
    v_match.id,
    p_state
  )

  on conflict (
    match_id
  )

  do nothing;

  if not found then
    raise exception 'match_already_started'
      using errcode = 'P0001';
  end if;

  /*
   * Waiting -> Playing
   */
  update okey.matches
  set
    status =
      'playing',

    version =
      0,

    public_projection =
      p_projection,

    turn_deadline_at =
      p_turn_deadline_at,

    countdown_deadline_at =
      null,

    updated_at =
      now()

  where id =
        v_match.id

    and status =
        'waiting'

  returning *
  into v_match;

  if not found then
    raise exception 'match_already_started'
      using errcode = 'P0001';
  end if;

  update okey.match_seats
  set
    connected = true,
    last_seen_at = now()

  where match_id =
        v_match.id

    and membership_released_at
        is null;

  return v_match.id;

end;
$function$;


/*
 * این دو RPC فقط از Edge Function با service_role
 * قابل اجرا هستند.
 */
revoke all
on function
  public.okey_preview_test_join_or_create(
    uuid,
    uuid[]
  )
from
  public,
  anon,
  authenticated;

grant execute
on function
  public.okey_preview_test_join_or_create(
    uuid,
    uuid[]
  )
to service_role;


revoke all
on function
  public.okey_preview_test_start(
    uuid,
    uuid,
    jsonb,
    jsonb,
    timestamptz
  )
from
  public,
  anon,
  authenticated;

grant execute
on function
  public.okey_preview_test_start(
    uuid,
    uuid,
    jsonb,
    jsonb,
    timestamptz
  )
to service_role;