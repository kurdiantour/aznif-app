-- Okey-only authoritative storage.
create schema if not exists okey;
revoke all on schema okey from public, anon, authenticated;
grant usage on schema okey to service_role;

create table okey.matches (
  id uuid primary key default gen_random_uuid(),
  ruleset_version text not null default 'okey-v1',
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished', 'cancelled')),
  version bigint not null default 0,
  turn_deadline_at timestamptz,
  public_projection jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create table okey.match_seats (
  match_id uuid not null references okey.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_index smallint not null check (player_index between 0 and 3),
  team_id text not null check (team_id in ('teamA', 'teamB')),
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id),
  unique (match_id, player_index)
);

create table okey.match_private_states (
  match_id uuid primary key references okey.matches(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table okey.match_commands (
  match_id uuid not null references okey.matches(id) on delete cascade,
  command_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  expected_version bigint not null,
  applied_version bigint not null,
  command_type text not null,
  created_at timestamptz not null default now(),
  primary key (match_id, command_id)
);

alter table okey.matches enable row level security;
alter table okey.match_seats enable row level security;
alter table okey.match_private_states enable row level security;
alter table okey.match_commands enable row level security;

-- The okey schema is intentionally service-only. Clients receive projections
-- from the Okey Edge Function and never query these tables directly.
revoke all on all tables in schema okey from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema okey to service_role;

create or replace function public.okey_get_authoritative_bundle(
  p_match_id uuid,
  p_user_id uuid,
  p_command_id uuid default null
) returns table(version bigint, status text, turn_deadline_at timestamptz, player_index smallint, state jsonb, command_applied boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  return query
  select m.version, m.status, m.turn_deadline_at, s.player_index, p.state,
    exists (
      select 1 from okey.match_commands command
      where command.match_id = m.id and command.command_id = p_command_id
    ) as command_applied
  from okey.matches m
  join okey.match_seats s on s.match_id = m.id and s.user_id = p_user_id
  join okey.match_private_states p on p.match_id = m.id
  where m.id = p_match_id;
end;
$$;

revoke all on function public.okey_get_authoritative_bundle(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.okey_get_authoritative_bundle(uuid, uuid, uuid) to service_role;

create or replace function public.okey_commit_authoritative_command(
  p_match_id uuid,
  p_user_id uuid,
  p_command_id uuid,
  p_expected_version bigint,
  p_command_type text,
  p_state jsonb,
  p_projection jsonb,
  p_status text,
  p_turn_deadline_at timestamptz
) returns table(applied boolean, version bigint, state jsonb, turn_deadline_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_match okey.matches%rowtype;
  v_existing okey.match_commands%rowtype;
  v_private_state jsonb;
  v_next_version bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_match from okey.matches where id = p_match_id for update;
  if not found then raise exception 'match_not_found' using errcode = 'P0002'; end if;

  select * into v_existing from okey.match_commands
  where match_id = p_match_id and command_id = p_command_id;
  if found then
    select private_state.state into v_private_state from okey.match_private_states private_state
    where private_state.match_id = p_match_id;
    return query select false, v_match.version, v_private_state, v_match.turn_deadline_at;
    return;
  end if;

  if v_match.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  if not exists (
    select 1 from okey.match_seats
    where match_id = p_match_id and user_id = p_user_id
  ) then raise exception 'not_a_participant' using errcode = '42501'; end if;

  v_next_version := v_match.version + 1;
  update okey.matches set
    version = v_next_version,
    status = p_status,
    public_projection = p_projection,
    turn_deadline_at = p_turn_deadline_at,
    updated_at = now(),
    finished_at = case when p_status = 'finished' then now() else finished_at end
  where id = p_match_id;

  update okey.match_private_states set state = p_state, updated_at = now()
  where match_id = p_match_id;
  if not found then raise exception 'private_state_not_found' using errcode = 'P0002'; end if;

  insert into okey.match_commands(
    match_id, command_id, user_id, expected_version, applied_version, command_type
  ) values (
    p_match_id, p_command_id, p_user_id, p_expected_version, v_next_version, p_command_type
  );

  return query select true, v_next_version, p_state, p_turn_deadline_at;
end;
$$;

revoke all on function public.okey_commit_authoritative_command(uuid, uuid, uuid, bigint, text, jsonb, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.okey_commit_authoritative_command(uuid, uuid, uuid, bigint, text, jsonb, jsonb, text, timestamptz) to service_role;