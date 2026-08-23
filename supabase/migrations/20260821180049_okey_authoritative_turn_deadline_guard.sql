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
  v_turn_changed boolean := false;
  v_state jsonb;
  v_player_id text;
  v_player_kind text;
  v_player_is_bot boolean := false;
  v_timeout_count integer := 0;
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

    v_turn_changed :=
      v_old_player_index is distinct from v_new_player_index
      or v_old_phase is distinct from v_new_phase
      or v_old_round is distinct from v_new_round;
  exception when others then
    v_turn_changed := true;
  end;

  if not v_turn_changed then
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
    v_player_id := v_state #>> array['roundState','players',v_new_player_index::text,'id'];
    v_player_kind := v_state #>> array['roundState','players',v_new_player_index::text,'kind'];
    v_player_is_bot :=
      coalesce((v_state #>> array['roundState','players',v_new_player_index::text,'controlledByBot'])::boolean, false)
      or v_player_kind = 'bot';

    if v_player_id is not null then
      v_timeout_count := coalesce((v_state #>> array['timeoutCountsByPlayerId',v_player_id])::integer, 0);
    end if;
  exception when others then
    v_player_is_bot := false;
    v_timeout_count := 0;
  end;

  if v_player_is_bot or v_timeout_count >= 2 then
    new.turn_deadline_at := null;
  else
    new.turn_deadline_at := clock_timestamp() + interval '30 seconds';
  end if;

  if new.public_projection is not null then
    new.public_projection := jsonb_set(
      new.public_projection,
      '{turnDeadlineAt}',
      coalesce(to_jsonb(new.turn_deadline_at), 'null'::jsonb),
      true
    );
  end if;

  return new;
end;
$$;

revoke all on function okey.enforce_authoritative_turn_deadline()
from public, anon, authenticated;

drop trigger if exists trg_okey_authoritative_turn_deadline on okey.matches;

create trigger trg_okey_authoritative_turn_deadline
before update of version on okey.matches
for each row
when (old.version is distinct from new.version)
execute function okey.enforce_authoritative_turn_deadline();
