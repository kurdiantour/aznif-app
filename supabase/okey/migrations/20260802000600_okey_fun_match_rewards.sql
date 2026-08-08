-- Okey Fun match rewards
--
-- Settles Point and Gem only after a successful winner settlement for a Fun
-- match.  The primary key on (match_id, user_id) makes each player's reward
-- idempotent even if settlement recovery calls the winner settlement again.

create table if not exists okey.fun_match_rewards (
  match_id uuid not null
    references okey.matches(id)
    on delete cascade,

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  team_id text not null
    check (team_id in ('teamA', 'teamB')),

  point_delta integer not null,

  gem_delta numeric(20,2) not null
    check (gem_delta >= 0),

  created_at timestamptz not null default now(),

  primary key (match_id, user_id)
);


alter table okey.fun_match_rewards enable row level security;

revoke all on table okey.fun_match_rewards
  from public, anon, authenticated;

grant select, insert, update, delete
  on table okey.fun_match_rewards
  to service_role;


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
begin
  -- Only a first, successful Fun winner settlement can issue rewards.
  if old.settlement_at is not null
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
    select *
    from okey.match_seats
    where match_id = new.id
    order by player_index
  loop
    v_point_delta := case
      when v_seat.team_id = v_winner_team_id then 35
      else -15
    end;

    v_gem_delta := case
      when v_seat.team_id = v_winner_team_id then 10
      else 0
    end;

    -- The match/user primary key is the reward idempotency barrier.
    insert into okey.fun_match_rewards (
      match_id,
      user_id,
      team_id,
      point_delta,
      gem_delta
    )
    values (
      new.id,
      v_seat.user_id,
      v_seat.team_id,
      v_point_delta,
      v_gem_delta
    )
    on conflict (match_id, user_id) do nothing;

    if not found then
      continue;
    end if;

    select coalesce(points, 0)
    into v_points_before
    from public.profiles
    where id = v_seat.user_id
    for update;

    if not found then
      raise exception 'profile_not_initialized';
    end if;

    update public.profiles
    set points = greatest(0, v_points_before + v_point_delta),
        updated_at = now()
    where id = v_seat.user_id;

    if v_gem_delta > 0 then
      update public.wallets
      set gem = gem + v_gem_delta,
          updated_at = now()
      where user_id = v_seat.user_id;

      if not found then
        raise exception 'wallet_not_initialized';
      end if;
    end if;
  end loop;

  return new;
end;
$$;


drop trigger if exists okey_apply_fun_match_rewards
  on okey.matches;

create trigger okey_apply_fun_match_rewards
after update of settlement_at on okey.matches
for each row
execute function okey.apply_fun_match_rewards();


revoke all on function okey.apply_fun_match_rewards()
  from public, anon, authenticated;

grant execute on function okey.apply_fun_match_rewards()
  to service_role;
