-- Queryable mirror of the authoritative next-round eligibility timestamp.
-- The canonical value remains in the private match state; this column lets the
-- Okey maintenance worker find abandoned FINISHED rounds without scanning all
-- active matches.

alter table okey.matches
  add column if not exists next_round_eligible_at timestamptz;

create index if not exists okey_matches_next_round_recovery_idx
  on okey.matches (next_round_eligible_at, updated_at)
  where status = 'playing'
    and next_round_eligible_at is not null;

create or replace function okey.sync_next_round_eligibility_from_state()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, okey
as $$
declare
  v_eligible_at timestamptz := null;
begin
  if new.state #>> '{roundState,phase}' = 'finished'
     and coalesce((new.state ->> 'matchFinished')::boolean, false) = false
     and nullif(new.state ->> 'nextRoundEligibleAt', '') is not null then
    v_eligible_at :=
      (new.state ->> 'nextRoundEligibleAt')::timestamptz;
  end if;

  update okey.matches
  set next_round_eligible_at = v_eligible_at
  where id = new.match_id;

  return new;
end;
$$;

drop trigger if exists sync_okey_next_round_eligibility
  on okey.match_private_states;

create trigger sync_okey_next_round_eligibility
after insert or update of state
on okey.match_private_states
for each row
execute function okey.sync_next_round_eligibility_from_state();

update okey.matches match
set next_round_eligible_at =
  case
    when private_state.state #>> '{roundState,phase}' = 'finished'
      and coalesce(
        (private_state.state ->> 'matchFinished')::boolean,
        false
      ) = false
    then nullif(
      private_state.state ->> 'nextRoundEligibleAt',
      ''
    )::timestamptz
    else null
  end
from okey.match_private_states private_state
where private_state.match_id = match.id;