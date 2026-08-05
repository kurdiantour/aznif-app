-- ============================================================================
-- Okey authoritative storage
--
-- Migration order:
--   1. This authoritative-storage migration
--   2. Okey room / matchmaking lifecycle
--   3. Okey production economy / chat lifecycle
--
-- The Okey schema is service-only.
-- Mobile clients never read private state directly.
-- No Domino object is referenced.
-- ============================================================================


-- ============================================================================
-- 1. Private Okey schema
-- ============================================================================

create schema if not exists okey;

revoke all on schema okey
  from public, anon, authenticated;

grant usage on schema okey
  to service_role;


-- ============================================================================
-- 2. Authoritative matches
-- ============================================================================

create table if not exists okey.matches (
  id uuid primary key default gen_random_uuid(),

  ruleset_version text not null default 'okey-v1',

  status text not null default 'waiting'
    check (
      status in (
        'waiting',
        'playing',
        'finished',
        'cancelled'
      )
    ),

  version bigint not null default 0
    check (version >= 0),

  turn_deadline_at timestamptz,

  public_projection jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  finished_at timestamptz
);


create index if not exists okey_matches_status_idx
  on okey.matches(status, updated_at);


-- ============================================================================
-- 3. Match seats
--
-- Teams:
--   player indexes 0 and 2 -> teamA
--   player indexes 1 and 3 -> teamB
--
-- Team assignment itself is performed by the room lifecycle RPC.
-- ============================================================================

create table if not exists okey.match_seats (
  match_id uuid not null
    references okey.matches(id)
    on delete cascade,

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  player_index smallint not null
    check (player_index between 0 and 3),

  team_id text not null
    check (team_id in ('teamA', 'teamB')),

  joined_at timestamptz not null default now(),

  primary key (match_id, user_id),

  unique (match_id, player_index)
);


create index if not exists okey_match_seats_user_idx
  on okey.match_seats(user_id, match_id);


-- ============================================================================
-- 4. Private authoritative state
--
-- Exactly one private state exists for each started match.
-- This table must never be exposed directly to clients.
-- ============================================================================

create table if not exists okey.match_private_states (
  match_id uuid primary key
    references okey.matches(id)
    on delete cascade,

  state jsonb not null,

  updated_at timestamptz not null default now()
);


-- ============================================================================
-- 5. Command idempotency history
--
-- The pair (match_id, command_id) guarantees that retrying the same command
-- cannot apply it twice.
-- ============================================================================

create table if not exists okey.match_commands (
  match_id uuid not null
    references okey.matches(id)
    on delete cascade,

  command_id uuid not null,

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  expected_version bigint not null
    check (expected_version >= 0),

  applied_version bigint not null
    check (applied_version > 0),

  command_type text not null
    check (char_length(trim(command_type)) between 1 and 100),

  created_at timestamptz not null default now(),

  primary key (match_id, command_id)
);


create index if not exists okey_match_commands_match_version_idx
  on okey.match_commands(match_id, applied_version);


create index if not exists okey_match_commands_user_idx
  on okey.match_commands(user_id, created_at);


-- ============================================================================
-- 6. RLS and service-only permissions
-- ============================================================================

alter table okey.matches
  enable row level security;

alter table okey.match_seats
  enable row level security;

alter table okey.match_private_states
  enable row level security;

alter table okey.match_commands
  enable row level security;


revoke all on table okey.matches
  from public, anon, authenticated;

revoke all on table okey.match_seats
  from public, anon, authenticated;

revoke all on table okey.match_private_states
  from public, anon, authenticated;

revoke all on table okey.match_commands
  from public, anon, authenticated;


grant select, insert, update, delete
  on table okey.matches
  to service_role;

grant select, insert, update, delete
  on table okey.match_seats
  to service_role;

grant select, insert, update, delete
  on table okey.match_private_states
  to service_role;

grant select, insert, update, delete
  on table okey.match_commands
  to service_role;


-- ============================================================================
-- 7. Fetch authoritative bundle
--
-- Returns:
--   current match version
--   current status
--   current turn deadline
--   requesting player's seat index
--   complete private state
--   whether the supplied command id was already applied
--
-- Only service_role may call this function.
-- ============================================================================

create or replace function public.okey_get_authoritative_bundle(
  p_match_id uuid,
  p_user_id uuid,
  p_command_id uuid default null
)
returns table (
  version bigint,
  status text,
  turn_deadline_at timestamptz,
  player_index smallint,
  state jsonb,
  command_applied boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required'
      using errcode = '22023';
  end if;

  if p_user_id is null then
    raise exception 'user_id_required'
      using errcode = '22023';
  end if;

  return query
  select
    match.version,
    match.status,
    match.turn_deadline_at,
    seat.player_index,
    private_state.state,

    case
      when p_command_id is null then false
      else exists (
        select 1
        from okey.match_commands command
        where command.match_id = match.id
          and command.command_id = p_command_id
      )
    end as command_applied

  from okey.matches match

  join okey.match_seats seat
    on seat.match_id = match.id
   and seat.user_id = p_user_id

  join okey.match_private_states private_state
    on private_state.match_id = match.id

  where match.id = p_match_id;
end;
$$;


revoke all on function public.okey_get_authoritative_bundle(
  uuid,
  uuid,
  uuid
)
from public, anon, authenticated;


grant execute on function public.okey_get_authoritative_bundle(
  uuid,
  uuid,
  uuid
)
to service_role;


-- ============================================================================
-- 8. Commit authoritative command
--
-- Guarantees:
--   match row is locked
--   command retry is idempotent
--   expected version must match current version
--   caller must occupy a seat in the match
--   private state and public projection update in one transaction
--   version increments exactly once
--
-- This function does not perform financial settlement.
-- Settlement is executed by okey_match or okey_maintenance after a successful
-- finished-state commit.
-- ============================================================================

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
)
returns table (
  applied boolean,
  version bigint,
  state jsonb,
  turn_deadline_at timestamptz
)
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
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required'
      using errcode = '22023';
  end if;

  if p_user_id is null then
    raise exception 'user_id_required'
      using errcode = '22023';
  end if;

  if p_command_id is null then
    raise exception 'command_id_required'
      using errcode = '22023';
  end if;

  if p_expected_version is null
     or p_expected_version < 0 then
    raise exception 'invalid_expected_version'
      using errcode = '22023';
  end if;

  if p_command_type is null
     or char_length(trim(p_command_type)) = 0
     or char_length(p_command_type) > 100 then
    raise exception 'invalid_command_type'
      using errcode = '22023';
  end if;

  if p_state is null then
    raise exception 'state_required'
      using errcode = '22023';
  end if;

  if p_projection is null then
    raise exception 'projection_required'
      using errcode = '22023';
  end if;

  if p_status not in ('playing', 'finished') then
    raise exception 'invalid_commit_status'
      using errcode = '22023';
  end if;


  -- Lock the match so version validation and commit are atomic.
  select *
  into v_match
  from okey.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found'
      using errcode = 'P0002';
  end if;


  -- A finished or cancelled match may not accept new commands.
  if v_match.status in ('finished', 'cancelled') then
    raise exception 'match_not_active'
      using errcode = 'P0001';
  end if;

  if v_match.status <> 'playing' then
    raise exception 'match_not_playing'
      using errcode = 'P0001';
  end if;


  -- Return the current result when this command was already committed.
  select *
  into v_existing
  from okey.match_commands
  where match_id = p_match_id
    and command_id = p_command_id;

  if found then
    select private_state.state
    into v_private_state
    from okey.match_private_states private_state
    where private_state.match_id = p_match_id;

    if not found then
      raise exception 'private_state_not_found'
        using errcode = 'P0002';
    end if;

    return query
    select
      false,
      v_match.version,
      v_private_state,
      v_match.turn_deadline_at;

    return;
  end if;


  if v_match.version <> p_expected_version then
    raise exception 'version_conflict'
      using errcode = '40001';
  end if;


  if not exists (
    select 1
    from okey.match_seats seat
    where seat.match_id = p_match_id
      and seat.user_id = p_user_id
  ) then
    raise exception 'not_a_participant'
      using errcode = '42501';
  end if;


  v_next_version := v_match.version + 1;


  update okey.match_private_states
  set
    state = p_state,
    updated_at = now()
  where match_id = p_match_id;

  if not found then
    raise exception 'private_state_not_found'
      using errcode = 'P0002';
  end if;


  update okey.matches
  set
    version = v_next_version,
    status = p_status,
    public_projection = p_projection,

    turn_deadline_at =
      case
        when p_status = 'finished'
          then null
        else p_turn_deadline_at
      end,

    updated_at = now(),

    finished_at =
      case
        when p_status = 'finished'
          then coalesce(finished_at, now())
        else finished_at
      end

  where id = p_match_id;


  insert into okey.match_commands (
    match_id,
    command_id,
    user_id,
    expected_version,
    applied_version,
    command_type
  )
  values (
    p_match_id,
    p_command_id,
    p_user_id,
    p_expected_version,
    v_next_version,
    trim(p_command_type)
  );


  return query
  select
    true,
    v_next_version,
    p_state,

    case
      when p_status = 'finished'
        then null::timestamptz
      else p_turn_deadline_at
    end;
end;
$$;


revoke all on function public.okey_commit_authoritative_command(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  jsonb,
  jsonb,
  text,
  timestamptz
)
from public, anon, authenticated;


grant execute on function public.okey_commit_authoritative_command(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  jsonb,
  jsonb,
  text,
  timestamptz
)
to service_role;