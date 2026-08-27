create or replace function okey.enforce_authoritative_turn_deadline()
returns trigger
language plpgsql
set search_path = pg_catalog, okey
as $$
declare
  v_old_player_index integer;
  v_new_player_index integer;
  v_old_phase text;
  v_new_phase text;
  v_old_round integer;
  v_new_round integer;
  v_old_has_drawn boolean;
  v_new_has_drawn boolean;
  v_timer_phase_changed boolean := false;
  v_state jsonb;
  v_player_kind text;
  v_player_is_bot boolean := false;
begin
  if new.version is not distinct from old.version then
    return new;
  end if;

  if new.status = 'finished' then
    new.turn_deadline_at := null;
    if new.public_projection is not null then
      new.public_projection := jsonb_set(new.public_projection, '{turnDeadlineAt}', 'null'::jsonb, true);
    end if;
    return new;
  end if;

  begin
    v_old_player_index := nullif(old.public_projection ->> 'currentPlayerIndex', '')::integer;
    v_new_player_index := nullif(new.public_projection ->> 'currentPlayerIndex', '')::integer;
    v_old_phase := old.public_projection ->> 'phase';
    v_new_phase := new.public_projection ->> 'phase';
    v_old_round := nullif(old.public_projection ->> 'currentRound', '')::integer;
    v_new_round := nullif(new.public_projection ->> 'currentRound', '')::integer;
    v_old_has_drawn := coalesce((old.public_projection ->> 'hasDrawnThisTurn')::boolean, false);
    v_new_has_drawn := coalesce((new.public_projection ->> 'hasDrawnThisTurn')::boolean, false);

    v_timer_phase_changed :=
      v_old_player_index is distinct from v_new_player_index
      or v_old_phase is distinct from v_new_phase
      or v_old_round is distinct from v_new_round
      or v_old_has_drawn is distinct from v_new_has_drawn;
  exception when others then
    v_timer_phase_changed := true;
  end;

  if not v_timer_phase_changed then
    return new;
  end if;

  select s.state
  into v_state
  from okey.match_private_states s
  where s.match_id = new.id;

  if v_state is null then
    return new;
  end if;

  begin
    v_new_player_index := (v_state #>> '{roundState,currentPlayerIndex}')::integer;
    v_new_has_drawn := coalesce((v_state #>> '{roundState,hasDrawnThisTurn}')::boolean, false);
    v_player_kind := v_state #>> array['roundState','players',v_new_player_index::text,'kind'];
    v_player_is_bot :=
      coalesce((v_state #>> array['roundState','players',v_new_player_index::text,'controlledByBot'])::boolean, false)
      or v_player_kind = 'bot';
  exception when others then
    v_player_is_bot := false;
  end;

  if v_player_is_bot then
    new.turn_deadline_at := null;
  elsif v_new_has_drawn then
    new.turn_deadline_at := clock_timestamp() + interval '30 seconds';
  else
    new.turn_deadline_at := clock_timestamp() + interval '15 seconds';
  end if;

  if new.public_projection is not null then
    new.public_projection := jsonb_set(
      new.public_projection,
      '{turnDeadlineAt}',
      coalesce(to_jsonb(new.turn_deadline_at), 'null'::jsonb),
      true
    );
    new.public_projection := jsonb_set(
      new.public_projection,
      '{turnDurationSeconds}',
      to_jsonb(case when v_new_has_drawn then 30 else 15 end),
      true
    );
  end if;

  return new;
end;
$$;

revoke all on function okey.enforce_authoritative_turn_deadline()
from public, anon, authenticated;