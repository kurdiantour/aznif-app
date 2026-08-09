-- Okey manual-leave economy settlement.
-- Reuses public.okey_settle_match and excludes every manually-left user from
-- prize, Fun points, and Fun gems. A null winner is legal only when no active
-- (non-left) human remains, and settles without prize or refund.

create or replace function public.okey_settle_match(
  p_match_id uuid,
  p_winner_team_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_match okey.matches%rowtype;
  v_seat okey.match_seats%rowtype;
  v_manual_left_player_ids jsonb := '[]'::jsonb;
  v_charged_players integer;
  v_remaining_humans integer;
  v_eligible_winners integer;
  v_payout_per_winner numeric(20,2);
  v_balance_before numeric(20,2);
  v_balance_after numeric(20,2);
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required' using errcode = '22023';
  end if;

  select *
  into v_match
  from okey.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if v_match.settlement_at is not null then
    if coalesce(v_match.settlement->>'type', '') in ('winner', 'no_winner') then
      return coalesce(v_match.settlement, '{}'::jsonb);
    end if;
    raise exception 'match_already_settled' using errcode = 'P0001';
  end if;

  select coalesce(state->'manualLeftPlayerIds', '[]'::jsonb)
  into v_manual_left_player_ids
  from okey.match_private_states
  where match_id = p_match_id;

  v_manual_left_player_ids := coalesce(v_manual_left_player_ids, '[]'::jsonb);

  select count(*)
  into v_charged_players
  from okey.wallet_ledger
  where match_id = p_match_id
    and reason = 'entry_fee';

  if v_match.entry_fee > 0 and v_charged_players <> 4 then
    raise exception 'entry_fee_not_fully_charged' using errcode = 'P0001';
  end if;

  select count(*)
  into v_remaining_humans
  from okey.match_seats seat
  where seat.match_id = p_match_id
    and not (v_manual_left_player_ids ? seat.user_id::text);

  if p_winner_team_id is null then
    if v_remaining_humans <> 0 then
      raise exception 'no_winner_requires_zero_humans' using errcode = 'P0001';
    end if;

    v_result := jsonb_build_object(
      'type', 'no_winner',
      'currency', v_match.currency,
      'entryFeePerPlayer', v_match.entry_fee,
      'totalEntry', v_match.total_entry,
      'totalCommission', v_match.total_commission,
      'prizePool', v_match.prize_pool,
      'payoutPerWinner', 0,
      'eligibleWinnerCount', 0,
      'refundPerPlayer', 0,
      'refundedPlayers', 0,
      'manualLeftPlayerIds', v_manual_left_player_ids
    );

    update okey.matches
    set status = 'finished',
        turn_deadline_at = null,
        settlement_at = now(),
        settlement = v_result,
        updated_at = now()
    where id = p_match_id;

    return v_result;
  end if;

  if p_winner_team_id not in ('teamA', 'teamB') then
    raise exception 'invalid_winner_team' using errcode = '22023';
  end if;

  if v_match.currency = 'fun'
     and (v_match.total_commission <> 0 or v_match.prize_pool <> v_match.total_entry) then
    raise exception 'invalid_fun_economy_configuration' using errcode = 'P0001';
  end if;

  v_payout_per_winner := round(v_match.prize_pool / 2, 2);
  if round(v_payout_per_winner * 2, 2) <> v_match.prize_pool then
    raise exception 'prize_pool_not_evenly_divisible' using errcode = 'P0001';
  end if;

  select count(*)
  into v_eligible_winners
  from okey.match_seats seat
  where seat.match_id = p_match_id
    and seat.team_id = p_winner_team_id
    and not (v_manual_left_player_ids ? seat.user_id::text);

  for v_seat in
    select *
    from okey.match_seats seat
    where seat.match_id = p_match_id
      and seat.team_id = p_winner_team_id
      and not (v_manual_left_player_ids ? seat.user_id::text)
    order by seat.player_index
  loop
    if v_match.currency = 'aznif' then
      select mc into v_balance_before
      from public.wallets
      where user_id = v_seat.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized' using errcode = 'P0001';
      end if;

      update public.wallets
      set mc = mc + v_payout_per_winner, updated_at = now()
      where user_id = v_seat.user_id
      returning mc into v_balance_after;
    elsif v_match.currency = 'fun' then
      select coin into v_balance_before
      from public.wallets
      where user_id = v_seat.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized' using errcode = 'P0001';
      end if;

      update public.wallets
      set coin = coin + v_payout_per_winner, updated_at = now()
      where user_id = v_seat.user_id
      returning coin into v_balance_after;
    else
      raise exception 'invalid_match_currency' using errcode = '22023';
    end if;

    insert into okey.wallet_ledger (
      user_id, match_id, currency, amount, reason, idempotency_key, metadata
    )
    values (
      v_seat.user_id,
      p_match_id,
      v_match.currency,
      v_payout_per_winner,
      'prize',
      p_match_id::text || ':prize:' || p_winner_team_id || ':' || v_seat.user_id::text,
      jsonb_build_object(
        'winnerTeamId', p_winner_team_id,
        'balanceBefore', v_balance_before,
        'balanceAfter', v_balance_after,
        'payout', v_payout_per_winner,
        'manualLeaveEligible', true
      )
    );
  end loop;

  v_result := jsonb_build_object(
    'type', 'winner',
    'currency', v_match.currency,
    'winnerTeamId', p_winner_team_id,
    'entryFeePerPlayer', v_match.entry_fee,
    'commissionRate', v_match.commission_rate,
    'commissionPerPlayer', v_match.commission_per_player,
    'totalEntry', v_match.total_entry,
    'totalCommission', v_match.total_commission,
    'commissionBurned', v_match.currency = 'aznif' and v_match.total_commission > 0,
    'prizePool', v_match.prize_pool,
    'payoutPerWinner', v_payout_per_winner,
    'eligibleWinnerCount', v_eligible_winners,
    'manualLeftPlayerIds', v_manual_left_player_ids
  );

  update okey.matches
  set status = 'finished',
      turn_deadline_at = null,
      settlement_at = now(),
      settlement = v_result,
      updated_at = now()
  where id = p_match_id;

  return v_result;
end;
$$;

create or replace function okey.apply_fun_match_rewards()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_winner_team_id text;
  v_manual_left_player_ids jsonb := '[]'::jsonb;
  v_seat okey.match_seats%rowtype;
  v_points_before integer;
  v_point_delta integer;
  v_gem_delta numeric(20,2);
begin
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

  select coalesce(state->'manualLeftPlayerIds', '[]'::jsonb)
  into v_manual_left_player_ids
  from okey.match_private_states
  where match_id = new.id;

  v_manual_left_player_ids := coalesce(v_manual_left_player_ids, '[]'::jsonb);

  for v_seat in
    select *
    from okey.match_seats
    where match_id = new.id
    order by player_index
  loop
    v_point_delta := case
      when v_seat.team_id = v_winner_team_id
       and not (v_manual_left_player_ids ? v_seat.user_id::text) then 35
      else -15
    end;

    v_gem_delta := case
      when v_seat.team_id = v_winner_team_id
       and not (v_manual_left_player_ids ? v_seat.user_id::text) then 10
      else 0
    end;

    insert into okey.fun_match_rewards (
      match_id, user_id, team_id, point_delta, gem_delta
    )
    values (
      new.id, v_seat.user_id, v_seat.team_id, v_point_delta, v_gem_delta
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
      set gem = gem + v_gem_delta, updated_at = now()
      where user_id = v_seat.user_id;

      if not found then
        raise exception 'wallet_not_initialized';
      end if;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.okey_settle_match(uuid, text)
  from public, anon, authenticated;
grant execute on function public.okey_settle_match(uuid, text)
  to service_role;

revoke all on function okey.apply_fun_match_rewards()
  from public, anon, authenticated;
grant execute on function okey.apply_fun_match_rewards()
  to service_role;

