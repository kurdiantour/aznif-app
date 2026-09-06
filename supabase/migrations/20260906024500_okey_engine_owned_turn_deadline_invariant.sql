-- Okey deadline ownership migration.
--
-- TypeScript authoritative engine is now the only gameplay owner that derives
-- turn_deadline_at. The database trigger no longer calculates, shifts, clears,
-- or rewrites deadlines. It only rejects commits whose persisted deadline does
-- not match the authoritative state/projection contract.

create or replace function okey.enforce_authoritative_turn_deadline()
returns trigger
language plpgsql
set search_path = pg_catalog, okey
as $$
declare
  v_state jsonb;
  v_round_phase text;
  v_player_index integer;
  v_has_drawn boolean := false;
  v_player_kind text;
  v_player_controlled_by_bot boolean := false;
  v_player_eliminated boolean := false;
  v_projection_deadline timestamptz;
  v_projection_duration integer;
  v_expected_duration integer;
begin
  if new.version is not distinct from old.version then
    return new;
  end if;

  -- Terminal/non-playing match rows must never carry a live turn deadline.
  if new.status <> 'playing' then
    if new.turn_deadline_at is not null then
      raise exception 'okey_deadline_forbidden_for_non_playing_match'
        using errcode = '23514';
    end if;

    if new.public_projection is not null
       and new.public_projection ? 'turnDeadlineAt'
       and new.public_projection -> 'turnDeadlineAt' <> 'null'::jsonb then
      raise exception 'okey_projection_deadline_forbidden_for_non_playing_match'
        using errcode = '23514';
    end if;

    return new;
  end if;

  select private_state.state
  into v_state
  from okey.match_private_states private_state
  where private_state.match_id = new.id;

  if v_state is null then
    raise exception 'okey_private_state_required_for_deadline_validation'
      using errcode = '23514';
  end if;

  begin
    v_round_phase := v_state #>> '{roundState,phase}';
    v_player_index := (v_state #>> '{roundState,currentPlayerIndex}')::integer;
    v_has_drawn := coalesce(
      (v_state #>> '{roundState,hasDrawnThisTurn}')::boolean,
      false
    );

    v_player_kind :=
      v_state #>> array['roundState','players',v_player_index::text,'kind'];

    v_player_controlled_by_bot := coalesce(
      (
        v_state #>>
        array['roundState','players',v_player_index::text,'controlledByBot']
      )::boolean,
      false
    );

    v_player_eliminated := coalesce(
      (
        v_state #>>
        array['roundState','players',v_player_index::text,'eliminated']
      )::boolean,
      false
    );
  exception when others then
    raise exception 'okey_deadline_state_invalid'
      using errcode = '23514';
  end;

  -- Bot, ghost/eliminated, and round-finished states have no Human countdown.
  if v_round_phase is distinct from 'playing'
     or v_player_controlled_by_bot
     or v_player_kind = 'bot'
     or v_player_eliminated then

    if new.turn_deadline_at is not null then
      raise exception 'okey_deadline_forbidden_for_non_human_turn'
        using errcode = '23514';
    end if;

    if new.public_projection is not null
       and new.public_projection ? 'turnDeadlineAt'
       and new.public_projection -> 'turnDeadlineAt' <> 'null'::jsonb then
      raise exception 'okey_projection_deadline_forbidden_for_non_human_turn'
        using errcode = '23514';
    end if;

    return new;
  end if;

  -- A playing Human turn must arrive with the deadline already derived by the
  -- authoritative TypeScript engine. The database validates; it never creates.
  if new.turn_deadline_at is null then
    raise exception 'okey_deadline_required_for_human_turn'
      using errcode = '23514';
  end if;

  if new.public_projection is null
     or not (new.public_projection ? 'turnDeadlineAt') then
    raise exception 'okey_projection_deadline_required_for_human_turn'
      using errcode = '23514';
  end if;

  begin
    v_projection_deadline :=
      nullif(new.public_projection ->> 'turnDeadlineAt', '')::timestamptz;
  exception when others then
    raise exception 'okey_projection_deadline_invalid'
      using errcode = '23514';
  end;

  if v_projection_deadline is distinct from new.turn_deadline_at then
    raise exception 'okey_projection_deadline_mismatch'
      using errcode = '23514';
  end if;

  v_expected_duration := case when v_has_drawn then 30 else 15 end;

  if new.public_projection is null
     or not (new.public_projection ? 'turnDurationSeconds') then
    raise exception 'okey_projection_duration_required'
      using errcode = '23514';
  end if;

  begin
    v_projection_duration :=
      (new.public_projection ->> 'turnDurationSeconds')::integer;
  exception when others then
    raise exception 'okey_projection_duration_invalid'
      using errcode = '23514';
  end;

  if v_projection_duration is distinct from v_expected_duration then
    raise exception 'okey_projection_duration_mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function okey.enforce_authoritative_turn_deadline()
from public, anon, authenticated;

-- Keep the existing version-transition boundary. Match start (waiting ->
-- playing at version 0) already receives its deadline from the TypeScript
-- authoritative match-start path; gameplay version commits are guarded here.
drop trigger if exists trg_okey_authoritative_turn_deadline on okey.matches;

create trigger trg_okey_authoritative_turn_deadline
before update of version on okey.matches
for each row
when (old.version is distinct from new.version)
execute function okey.enforce_authoritative_turn_deadline();

