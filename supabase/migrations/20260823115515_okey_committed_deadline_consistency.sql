-- Return the deadline actually persisted after the authoritative BEFORE UPDATE guard.
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
  v_committed_deadline timestamptz;
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

  where id = p_match_id
  returning okey.matches.turn_deadline_at into v_committed_deadline;


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

    v_committed_deadline;
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
