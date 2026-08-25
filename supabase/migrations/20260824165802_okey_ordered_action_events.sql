create table if not exists okey.match_action_events (
  match_id uuid not null references okey.matches(id) on delete cascade,
  version bigint not null check (version > 0),
  sequence integer not null check (sequence >= 0),
  action_type text not null check (char_length(action_type) between 1 and 100),
  actor_player_id text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (match_id, version, sequence)
);
alter table okey.match_action_events enable row level security;
revoke all on table okey.match_action_events from public, anon, authenticated;
grant select, insert on table okey.match_action_events to service_role;

create or replace function public.okey_commit_authoritative_action(
  p_match_id uuid, p_user_id uuid, p_command_id uuid, p_expected_version bigint,
  p_command_type text, p_state jsonb, p_projection jsonb, p_status text,
  p_turn_deadline_at timestamptz, p_action_events jsonb
)
returns table (applied boolean, version bigint, state jsonb, turn_deadline_at timestamptz, action_events jsonb)
language plpgsql security invoker set search_path = public, okey, pg_temp
as $$
declare
  v_result record;
  v_events jsonb := coalesce(p_action_events, '[]'::jsonb);
begin
  if jsonb_typeof(v_events) <> 'array' then
    raise exception 'action_events_must_be_array' using errcode = '22023';
  end if;
  select committed.applied, committed.version, committed.state, committed.turn_deadline_at
  into v_result
  from public.okey_commit_authoritative_command(
    p_match_id, p_user_id, p_command_id, p_expected_version, p_command_type,
    p_state, p_projection, p_status, p_turn_deadline_at
  ) committed;
  if v_result.applied then
    insert into okey.match_action_events(match_id, version, sequence, action_type, actor_player_id, payload)
    select p_match_id, v_result.version, event.ordinality::integer - 1,
           event.value->>'type', nullif(event.value->>'actorPlayerId', ''),
           coalesce(event.value->'payload', '{}'::jsonb)
    from jsonb_array_elements(v_events) with ordinality as event(value, ordinality)
    where jsonb_typeof(event.value) = 'object' and coalesce(event.value->>'type', '') <> '';
  end if;
  return query
  select v_result.applied, v_result.version, v_result.state, v_result.turn_deadline_at,
    coalesce((select jsonb_agg(jsonb_build_object(
      'matchId', stored.match_id, 'version', stored.version, 'sequence', stored.sequence,
      'type', stored.action_type, 'actorPlayerId', stored.actor_player_id,
      'payload', stored.payload, 'createdAt', stored.created_at
    ) order by stored.sequence)
    from okey.match_action_events stored
    where stored.match_id = p_match_id and stored.version = v_result.version), '[]'::jsonb);
end;
$$;
revoke all on function public.okey_commit_authoritative_action(uuid,uuid,uuid,bigint,text,jsonb,jsonb,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.okey_commit_authoritative_action(uuid,uuid,uuid,bigint,text,jsonb,jsonb,text,timestamptz,jsonb) to service_role;

create or replace function public.okey_commit_authoritative_action_with_events(
  p_match_id uuid, p_user_id uuid, p_command_id uuid, p_expected_version bigint,
  p_command_type text, p_state jsonb, p_projection jsonb, p_status text,
  p_turn_deadline_at timestamptz, p_gameplay_events jsonb, p_action_events jsonb
)
returns table (applied boolean, version bigint, state jsonb, turn_deadline_at timestamptz, action_events jsonb)
language plpgsql security invoker set search_path = public, okey, pg_temp
as $$
declare v_result record;
begin
  select committed.applied, committed.version, committed.state, committed.turn_deadline_at, committed.action_events
  into v_result
  from public.okey_commit_authoritative_action(
    p_match_id, p_user_id, p_command_id, p_expected_version, p_command_type,
    p_state, p_projection, p_status, p_turn_deadline_at, p_action_events
  ) committed;
  if v_result.applied then
    perform public.record_authoritative_okey_gameplay_events(
      p_match_id, p_command_id, coalesce(p_gameplay_events, '[]'::jsonb), clock_timestamp()
    );
  end if;
  return query select v_result.applied, v_result.version, v_result.state,
                      v_result.turn_deadline_at, v_result.action_events;
end;
$$;
revoke all on function public.okey_commit_authoritative_action_with_events(uuid,uuid,uuid,bigint,text,jsonb,jsonb,text,timestamptz,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.okey_commit_authoritative_action_with_events(uuid,uuid,uuid,bigint,text,jsonb,jsonb,text,timestamptz,jsonb,jsonb) to service_role;