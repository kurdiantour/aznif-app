create or replace function public.okey_commit_authoritative_command_with_events(
  p_match_id uuid,
  p_user_id uuid,
  p_command_id uuid,
  p_expected_version bigint,
  p_command_type text,
  p_state jsonb,
  p_projection jsonb,
  p_status text,
  p_turn_deadline_at timestamptz,
  p_gameplay_events jsonb
)
returns table(applied boolean, version bigint, state jsonb, turn_deadline_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'okey', 'pg_temp'
as $function$
declare
  v_result record;
  v_previous_state jsonb;
  v_seat okey.match_seats%rowtype;
  v_effective_deadline timestamptz := p_turn_deadline_at;
  v_effective_projection jsonb := p_projection;
  v_player_index integer;
  v_player_id text;
  v_player_kind text;
  v_player_is_bot boolean := false;
  v_timeout_count integer := 0;
begin
  /*
   * Defensive server-side guard for timeout commits.
   * A stale/expired deadline must never be committed again after a timeout,
   * otherwise clients/watchdogs can repeatedly resolve the same expired turn.
   */
  if p_command_type = 'system-timeout' and p_status = 'playing' then
    begin
      v_player_index := (p_state #>> '{roundState,currentPlayerIndex}')::integer;
      v_player_id := p_state #>> array['roundState','players',v_player_index::text,'id'];
      v_player_kind := p_state #>> array['roundState','players',v_player_index::text,'kind'];
      v_player_is_bot :=
        coalesce((p_state #>> array['roundState','players',v_player_index::text,'controlledByBot'])::boolean, false)
        or v_player_kind = 'bot';

      if v_player_id is not null then
        v_timeout_count := coalesce((p_state #>> array['timeoutCountsByPlayerId',v_player_id])::integer, 0);
      end if;
    exception when others then
      v_player_index := null;
      v_player_id := null;
      v_player_kind := null;
      v_player_is_bot := false;
      v_timeout_count := 0;
    end;

    if v_player_is_bot or v_timeout_count >= 2 then
      v_effective_deadline := null;
    else
      v_effective_deadline := clock_timestamp() + interval '25 seconds';
    end if;

    if v_effective_projection is not null then
      v_effective_projection := jsonb_set(
        v_effective_projection,
        '{turnDeadlineAt}',
        coalesce(to_jsonb(v_effective_deadline), 'null'::jsonb),
        true
      );
    end if;
  end if;

  select private_state.state into v_previous_state
  from okey.match_private_states private_state
  where private_state.match_id = p_match_id;

  select committed.applied, committed.version, committed.state, committed.turn_deadline_at
  into v_result
  from public.okey_commit_authoritative_command(
    p_match_id,
    p_user_id,
    p_command_id,
    p_expected_version,
    p_command_type,
    p_state,
    v_effective_projection,
    p_status,
    v_effective_deadline
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
      p_match_id,
      p_command_id,
      coalesce(p_gameplay_events, '[]'::jsonb),
      clock_timestamp()
    );
  end if;

  return query
  select v_result.applied, v_result.version, v_result.state, v_result.turn_deadline_at;
end;
$function$;
