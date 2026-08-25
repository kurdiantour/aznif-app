-- Production-path Okey preview matches for admin-only device testing.
-- Test matches use real Auth-backed seats and the normal authoritative runtime,
-- but are explicitly excluded from every economy/reward path.

alter table okey.matches
  add column if not exists is_test boolean not null default false;

create index if not exists okey_matches_test_owner_active_idx
  on okey.matches (created_by, updated_at desc)
  where is_test and status in ('waiting', 'playing');

create table if not exists okey.test_bot_accounts (
  slot smallint primary key check (slot between 1 and 3),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table okey.test_bot_accounts enable row level security;
revoke all on table okey.test_bot_accounts from public, anon, authenticated;
grant select, insert, update, delete on table okey.test_bot_accounts to service_role;

create or replace function public.okey_create_preview_test_match(
  p_owner_user_id uuid,
  p_bot_user_ids uuid[],
  p_state jsonb,
  p_projection jsonb,
  p_turn_deadline_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_match_id uuid := gen_random_uuid();
  v_owner_name text;
  v_owner_avatar text;
  v_bot_id uuid;
  v_slot integer;
begin
  if p_owner_user_id is null or p_state is null or p_projection is null then
    raise exception 'invalid_test_match_payload' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_owner_user_id and is_admin = true
  ) then
    raise exception 'admin_test_access_required' using errcode = '42501';
  end if;

  if coalesce(array_length(p_bot_user_ids, 1), 0) <> 3
     or (select count(distinct bot_id) from unnest(p_bot_user_ids) bot_id) <> 3
     or p_owner_user_id = any(p_bot_user_ids) then
    raise exception 'invalid_test_bot_set' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_bot_user_ids) with ordinality requested(user_id, slot)
    left join okey.test_bot_accounts configured
      on configured.user_id = requested.user_id
     and configured.slot = requested.slot
    left join auth.users bot_user
      on bot_user.id = requested.user_id
    where configured.user_id is null
       or bot_user.id is null
       or coalesce((bot_user.raw_app_meta_data->>'okey_test_bot')::boolean, false) is not true
  ) then
    raise exception 'untrusted_test_bot_account' using errcode = '42501';
  end if;

  select username, avatar_url
  into v_owner_name, v_owner_avatar
  from public.profiles
  where id = p_owner_user_id;

  insert into okey.matches (
    id, ruleset_version, status, version, turn_deadline_at,
    public_projection, table_id, room_code, created_by,
    countdown_deadline_at, entry_fee, currency, commission_rate,
    commission_per_player, total_entry, total_commission, prize_pool,
    is_test
  )
  values (
    v_match_id, 'okey-v1', 'playing', 0, p_turn_deadline_at,
    p_projection, 'preview-test', 'TEST-' || upper(substr(v_match_id::text, 1, 8)),
    p_owner_user_id, null, 0, 'fun', 0, 0, 0, 0, 0, true
  );

  insert into okey.match_seats (
    match_id, user_id, player_index, team_id, display_name, avatar_url,
    connected, last_seen_at
  )
  values (
    v_match_id, p_owner_user_id, 0, 'teamA',
    coalesce(nullif(trim(v_owner_name), ''), 'Test Player'),
    v_owner_avatar, true, now()
  );

  for v_slot in 1..3 loop
    v_bot_id := p_bot_user_ids[v_slot];
    insert into okey.match_seats (
      match_id, user_id, player_index, team_id, display_name, avatar_url,
      connected, last_seen_at, bot_since, bot_difficulty
    )
    values (
      v_match_id, v_bot_id, v_slot,
      case when v_slot = 2 then 'teamA' else 'teamB' end,
      'Test Bot ' || v_slot, null, false, now(), now(), 'normal'
    );
  end loop;

  insert into okey.match_private_states (match_id, state)
  values (v_match_id, p_state);

  return v_match_id;
end;
$$;

revoke all on function public.okey_create_preview_test_match(
  uuid, uuid[], jsonb, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.okey_create_preview_test_match(
  uuid, uuid[], jsonb, jsonb, timestamptz
) to service_role;

create or replace function okey.apply_fun_match_rewards()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_winner_team_id text;
  v_seat okey.match_seats%rowtype;
  v_points_before integer;
  v_point_delta integer;
  v_gem_delta numeric(20,2);
  v_is_bot boolean;
begin
  if new.is_test
     or old.settlement_at is not null
     or new.settlement_at is null
     or new.status <> 'finished'
     or new.currency <> 'fun'
     or coalesce(new.settlement->>'type', '') <> 'winner' then
    return new;
  end if;

  v_winner_team_id := new.settlement->>'winnerTeamId';
  if v_winner_team_id not in ('teamA', 'teamB') then
    raise exception 'invalid_fun_winner_team';
  end if;

  for v_seat in
    select * from okey.match_seats
    where match_id = new.id
    order by player_index
  loop
    select coalesce(p.controlledByBot, false) or (p.kind = 'bot')
    into v_is_bot
    from jsonb_to_recordset(
      (select state->'players' from okey.match_private_states where match_id = new.id)
    ) as p(id uuid, controlledByBot boolean, kind text)
    where p.id = v_seat.user_id;

    v_is_bot := coalesce(v_is_bot, false);
    v_point_delta := case
      when v_is_bot then -25
      when v_seat.team_id = v_winner_team_id then 35
      else -15
    end;
    v_gem_delta := case
      when not v_is_bot and v_seat.team_id = v_winner_team_id then 10
      else 0
    end;

    insert into okey.fun_match_rewards (
      match_id, user_id, team_id, point_delta, gem_delta
    ) values (
      new.id, v_seat.user_id, v_seat.team_id, v_point_delta, v_gem_delta
    ) on conflict (match_id, user_id) do nothing;

    if not found then continue; end if;

    select coalesce(points, 0) into v_points_before
    from public.profiles where id = v_seat.user_id for update;
    if not found then raise exception 'profile_not_initialized'; end if;

    update public.profiles
    set points = greatest(0, v_points_before + v_point_delta), updated_at = now()
    where id = v_seat.user_id;

    if v_gem_delta > 0 then
      update public.wallets
      set gem = gem + v_gem_delta, updated_at = now()
      where user_id = v_seat.user_id;
      if not found then raise exception 'wallet_not_initialized'; end if;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function okey.apply_fun_match_rewards()
  from public, anon, authenticated;
grant execute on function okey.apply_fun_match_rewards() to service_role;

notify pgrst, 'reload schema';
