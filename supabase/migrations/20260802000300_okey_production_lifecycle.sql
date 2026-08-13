-- ============================================================================
-- Okey production economy — FINAL
--
-- Economy rules:
--   fun   -> public.wallets.coin
--            0% commission
--            100% of total entry becomes prize pool
--
--   aznif -> public.wallets.mc
--            5% commission per player
--            commission is BURNED (credited to no wallet)
--            one audit-only ledger row records the burned amount
--
-- Important:
--   okey.wallet_ledger is an audit ledger, not a wallet.
--   No treasury/house wallet is created or credited.
-- ============================================================================


-- ============================================================================
-- 1. Match economy columns
-- ============================================================================

alter table okey.matches
  add column if not exists entry_fee numeric(20,2) not null default 0
    check (entry_fee >= 0),

  add column if not exists currency text not null default 'fun'
    check (currency in ('fun', 'aznif')),

  add column if not exists commission_rate numeric(6,5) not null default 0
    check (commission_rate >= 0 and commission_rate <= 1),

  add column if not exists commission_per_player numeric(20,2) not null default 0
    check (commission_per_player >= 0),

  add column if not exists total_entry numeric(20,2) not null default 0
    check (total_entry >= 0),

  add column if not exists total_commission numeric(20,2) not null default 0
    check (total_commission >= 0),

  add column if not exists prize_pool numeric(20,2) not null default 0
    check (prize_pool >= 0),

  add column if not exists settlement_at timestamptz,

  add column if not exists settlement jsonb;


-- ADD COLUMN IF NOT EXISTS does not change the default of an existing column.
alter table okey.matches
  alter column commission_rate set default 0;


alter table okey.match_seats
  add column if not exists bot_since timestamptz,

  add column if not exists bot_difficulty text
    check (bot_difficulty in ('easy', 'normal', 'hard'));


-- ============================================================================
-- 2. Okey audit ledger
--
-- This table never holds balances.
-- Real balances stay in public.wallets.
--
-- Ledger signs:
--   entry_fee        negative
--   house_commission positive (audit-only burned Aznif amount)
--   prize            positive
--   refund           positive
--
-- "house_commission" is retained for compatibility.
-- For new rows, metadata.event = "commission_burn".
-- ============================================================================

create table if not exists okey.wallet_ledger (
  id uuid primary key default gen_random_uuid(),

  user_id uuid references auth.users(id) on delete set null,

  match_id uuid references okey.matches(id) on delete set null,

  currency text not null
    check (currency in ('fun', 'aznif')),

  amount numeric(20,2) not null
    check (amount <> 0),

  reason text not null
    check (
      reason in (
        'entry_fee',
        'house_commission',
        'prize',
        'refund'
      )
    ),

  idempotency_key text not null unique,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);


create index if not exists okey_wallet_ledger_match_idx
  on okey.wallet_ledger(match_id, created_at);


create index if not exists okey_wallet_ledger_user_idx
  on okey.wallet_ledger(user_id, created_at);


alter table okey.wallet_ledger enable row level security;

revoke all on table okey.wallet_ledger
  from public, anon, authenticated;

grant select, insert, update, delete
  on table okey.wallet_ledger
  to service_role;


-- ============================================================================
-- 3. Configure and lock match economy
--
-- fun:
--   commission rate = 0%
--   prize pool      = total entry
--
-- aznif:
--   commission rate = 5%
--   burned amount   = total commission
--   prize pool      = total entry - total commission
-- ============================================================================

create or replace function public.okey_configure_match(
  p_match_id uuid,
  p_entry_fee numeric,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_currency text;
  v_commission_rate numeric(6,5);
  v_entry_fee numeric(20,2);
  v_commission_per_player numeric(20,2);
  v_total_entry numeric(20,2);
  v_total_commission numeric(20,2);
  v_prize_pool numeric(20,2);
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required'
      using errcode = '22023';
  end if;

  if p_entry_fee is null or p_entry_fee < 0 then
    raise exception 'invalid_entry_fee'
      using errcode = '22023';
  end if;

  v_currency := lower(trim(coalesce(p_currency, '')));

  if v_currency not in ('fun', 'aznif') then
    raise exception 'invalid_match_currency'
      using errcode = '22023';
  end if;

  v_entry_fee := round(p_entry_fee::numeric, 2);

  v_commission_rate :=
    case
      when v_currency = 'aznif' then 0.05::numeric
      else 0::numeric
    end;

  v_commission_per_player :=
    round(v_entry_fee * v_commission_rate, 2);

  v_total_entry :=
    round(v_entry_fee * 4, 2);

  v_total_commission :=
    round(v_commission_per_player * 4, 2);

  v_prize_pool :=
    round(v_total_entry - v_total_commission, 2);

  update okey.matches
  set
    entry_fee = v_entry_fee,
    currency = v_currency,
    commission_rate = v_commission_rate,
    commission_per_player = v_commission_per_player,
    total_entry = v_total_entry,
    total_commission = v_total_commission,
    prize_pool = v_prize_pool,
    updated_at = now()
  where id = p_match_id
    and status = 'waiting'
    and settlement_at is null;

  if not found then
    raise exception 'match_not_waiting'
      using errcode = 'P0001';
  end if;
end;
$$;


-- ============================================================================
-- 4. Charge all four players
--
-- aznif -> subtract entry fee from public.wallets.mc
-- fun   -> subtract entry fee from public.wallets.coin
--
-- Only Aznif receives a commission-burn audit record.
-- No commission amount is credited to any wallet.
-- ============================================================================

create or replace function public.okey_charge_entry_fee(
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_match okey.matches%rowtype;
  v_seat okey.match_seats%rowtype;

  v_seat_count integer;
  v_distinct_user_count integer;

  v_balance_before numeric(20,2);
  v_balance_after numeric(20,2);
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required'
      using errcode = '22023';
  end if;

  select *
  into v_match
  from okey.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found'
      using errcode = 'P0002';
  end if;

  if v_match.status <> 'waiting' then
    raise exception 'match_not_waiting'
      using errcode = 'P0001';
  end if;

  if v_match.entry_fee = 0 then
    return jsonb_build_object(
      'charged', false,
      'reason', 'free_match',
      'currency', v_match.currency,
      'entryFeePerPlayer', 0,
      'commissionRate', v_match.commission_rate,
      'commissionPerPlayer', 0,
      'totalEntry', 0,
      'totalCommission', 0,
      'prizePool', 0
    );
  end if;

  if exists (
    select 1
    from okey.wallet_ledger
    where match_id = p_match_id
      and reason = 'entry_fee'
  ) then
    return jsonb_build_object(
      'charged', false,
      'reason', 'already_charged',
      'currency', v_match.currency,
      'entryFeePerPlayer', v_match.entry_fee,
      'commissionRate', v_match.commission_rate,
      'commissionPerPlayer', v_match.commission_per_player,
      'totalEntry', v_match.total_entry,
      'totalCommission', v_match.total_commission,
      'prizePool', v_match.prize_pool
    );
  end if;

  -- Defensive validation: fun must never contain commission.
  if v_match.currency = 'fun'
     and (
       v_match.commission_rate <> 0
       or v_match.commission_per_player <> 0
       or v_match.total_commission <> 0
       or v_match.prize_pool <> v_match.total_entry
     ) then
    raise exception 'invalid_fun_economy_configuration'
      using errcode = 'P0001';
  end if;

  -- Defensive validation: Aznif uses the configured 5% model.
  if v_match.currency = 'aznif'
     and v_match.commission_rate <> 0.05 then
    raise exception 'invalid_aznif_commission_rate'
      using errcode = 'P0001';
  end if;

  select
    count(*),
    count(distinct user_id)
  into
    v_seat_count,
    v_distinct_user_count
  from okey.match_seats
  where match_id = p_match_id;

  if v_seat_count <> 4
     or v_distinct_user_count <> 4 then
    raise exception 'match_requires_four_unique_players'
      using errcode = 'P0001';
  end if;

  for v_seat in
    select *
    from okey.match_seats
    where match_id = p_match_id
    order by player_index
  loop
    if v_seat.user_id is null then
      raise exception 'seat_missing_user'
        using errcode = 'P0001';
    end if;

    if v_match.currency = 'aznif' then
      select mc
      into v_balance_before
      from public.wallets
      where user_id = v_seat.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized'
          using errcode = 'P0001';
      end if;

      if v_balance_before < v_match.entry_fee then
        raise exception 'insufficient_entry_balance'
          using errcode = 'P0001';
      end if;

      update public.wallets
      set
        mc = mc - v_match.entry_fee,
        updated_at = now()
      where user_id = v_seat.user_id
      returning mc
      into v_balance_after;

    elsif v_match.currency = 'fun' then
      select coin
      into v_balance_before
      from public.wallets
      where user_id = v_seat.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized'
          using errcode = 'P0001';
      end if;

      if v_balance_before < v_match.entry_fee then
        raise exception 'insufficient_entry_balance'
          using errcode = 'P0001';
      end if;

      update public.wallets
      set
        coin = coin - v_match.entry_fee,
        updated_at = now()
      where user_id = v_seat.user_id
      returning coin
      into v_balance_after;

    else
      raise exception 'invalid_match_currency'
        using errcode = '22023';
    end if;

    insert into okey.wallet_ledger (
      user_id,
      match_id,
      currency,
      amount,
      reason,
      idempotency_key,
      metadata
    )
    values (
      v_seat.user_id,
      p_match_id,
      v_match.currency,
      -v_match.entry_fee,
      'entry_fee',
      p_match_id::text
        || ':entry:'
        || v_seat.user_id::text,
      jsonb_build_object(
        'playerIndex', v_seat.player_index,
        'teamId', v_seat.team_id,
        'balanceBefore', v_balance_before,
        'balanceAfter', v_balance_after,
        'entryFee', v_match.entry_fee,
        'commissionPart', v_match.commission_per_player,
        'prizePoolPart',
          round(
            v_match.entry_fee - v_match.commission_per_player,
            2
          )
      )
    );
  end loop;

  -- Audit-only burn record.
  -- It exists only for Aznif and credits no wallet.
  if v_match.currency = 'aznif'
     and v_match.total_commission > 0 then
    insert into okey.wallet_ledger (
      user_id,
      match_id,
      currency,
      amount,
      reason,
      idempotency_key,
      metadata
    )
    values (
      null,
      p_match_id,
      'aznif',
      v_match.total_commission,
      'house_commission',
      p_match_id::text || ':commission-burn',
      jsonb_build_object(
        'event', 'commission_burn',
        'burned', true,
        'creditedToWallet', false,
        'destination', 'none',
        'commissionRate', v_match.commission_rate,
        'commissionPerPlayer', v_match.commission_per_player,
        'playerCount', 4,
        'totalCommission', v_match.total_commission
      )
    );
  end if;

  return jsonb_build_object(
    'charged', true,
    'currency', v_match.currency,
    'entryFeePerPlayer', v_match.entry_fee,
    'commissionRate', v_match.commission_rate,
    'commissionPerPlayer', v_match.commission_per_player,
    'totalEntry', v_match.total_entry,
    'totalCommission', v_match.total_commission,
    'prizePool', v_match.prize_pool,
    'commissionBurned',
      v_match.currency = 'aznif'
      and v_match.total_commission > 0
  );
end;
$$;


-- ============================================================================
-- 5. Winner settlement
--
-- The prize pool is split equally between exactly two winning teammates.
-- Commission is not transferred here; the Aznif commission was already burned
-- when entry fees were charged.
--
-- Cancellation/full refund must remain in:
--   public.okey_cancel_match_and_refund(uuid, text)
-- and must use the same currency rules.
-- ============================================================================

create or replace function public.okey_settle_match(
  p_match_id uuid,
  p_winner_team_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_match okey.matches%rowtype;
  v_seat okey.match_seats%rowtype;

  v_winners integer;
  v_charged_players integer;

  v_payout_per_winner numeric(20,2);

  v_balance_before numeric(20,2);
  v_balance_after numeric(20,2);
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required'
      using errcode = '22023';
  end if;

  select *
  into v_match
  from okey.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found'
      using errcode = 'P0002';
  end if;

  if v_match.settlement_at is not null then
    if coalesce(v_match.settlement->>'type', '') = 'winner' then
      return coalesce(v_match.settlement, '{}'::jsonb);
    end if;

    raise exception 'match_already_settled'
      using errcode = 'P0001';
  end if;

  select count(*)
  into v_charged_players
  from okey.wallet_ledger
  where match_id = p_match_id
    and reason = 'entry_fee';

  if v_match.entry_fee > 0
     and v_charged_players <> 4 then
    raise exception 'entry_fee_not_fully_charged'
      using errcode = 'P0001';
  end if;

  if p_winner_team_id is null
     or p_winner_team_id not in ('teamA', 'teamB') then
    raise exception 'invalid_winner_team'
      using errcode = '22023';
  end if;

  select count(*)
  into v_winners
  from okey.match_seats
  where match_id = p_match_id
    and team_id = p_winner_team_id;

  if v_winners <> 2 then
    raise exception 'winning_team_must_have_two_players'
      using errcode = 'P0001';
  end if;

  if v_match.currency = 'fun'
     and (
       v_match.total_commission <> 0
       or v_match.prize_pool <> v_match.total_entry
     ) then
    raise exception 'invalid_fun_economy_configuration'
      using errcode = 'P0001';
  end if;

  v_payout_per_winner :=
    round(v_match.prize_pool / 2, 2);

  if round(v_payout_per_winner * 2, 2)
     <> v_match.prize_pool then
    raise exception 'prize_pool_not_evenly_divisible'
      using errcode = 'P0001';
  end if;

  for v_seat in
    select *
    from okey.match_seats
    where match_id = p_match_id
      and team_id = p_winner_team_id
    order by player_index
  loop
    if v_match.currency = 'aznif' then
      select mc
      into v_balance_before
      from public.wallets
      where user_id = v_seat.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized'
          using errcode = 'P0001';
      end if;

      update public.wallets
      set
        mc = mc + v_payout_per_winner,
        updated_at = now()
      where user_id = v_seat.user_id
      returning mc
      into v_balance_after;

    elsif v_match.currency = 'fun' then
      select coin
      into v_balance_before
      from public.wallets
      where user_id = v_seat.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized'
          using errcode = 'P0001';
      end if;

      update public.wallets
      set
        coin = coin + v_payout_per_winner,
        updated_at = now()
      where user_id = v_seat.user_id
      returning coin
      into v_balance_after;

    else
      raise exception 'invalid_match_currency'
        using errcode = '22023';
    end if;

    insert into okey.wallet_ledger (
      user_id,
      match_id,
      currency,
      amount,
      reason,
      idempotency_key,
      metadata
    )
    values (
      v_seat.user_id,
      p_match_id,
      v_match.currency,
      v_payout_per_winner,
      'prize',
      p_match_id::text
        || ':prize:'
        || p_winner_team_id
        || ':'
        || v_seat.user_id::text,
      jsonb_build_object(
        'winnerTeamId', p_winner_team_id,
        'balanceBefore', v_balance_before,
        'balanceAfter', v_balance_after,
        'payout', v_payout_per_winner
      )
    );
  end loop;

  update okey.matches
  set
    status = 'finished',
    settlement_at = now(),
    settlement = jsonb_build_object(
      'type', 'winner',
      'currency', v_match.currency,
      'winnerTeamId', p_winner_team_id,
      'entryFeePerPlayer', v_match.entry_fee,
      'commissionRate', v_match.commission_rate,
      'commissionPerPlayer', v_match.commission_per_player,
      'totalEntry', v_match.total_entry,
      'totalCommission', v_match.total_commission,
      'commissionBurned',
        v_match.currency = 'aznif'
        and v_match.total_commission > 0,
      'prizePool', v_match.prize_pool,
      'payoutPerWinner', v_payout_per_winner
    ),
    updated_at = now()
  where id = p_match_id;

  return jsonb_build_object(
    'type', 'winner',
    'currency', v_match.currency,
    'winnerTeamId', p_winner_team_id,
    'entryFeePerPlayer', v_match.entry_fee,
    'commissionRate', v_match.commission_rate,
    'commissionPerPlayer', v_match.commission_per_player,
    'totalEntry', v_match.total_entry,
    'totalCommission', v_match.total_commission,
    'commissionBurned',
      v_match.currency = 'aznif'
      and v_match.total_commission > 0,
    'prizePool', v_match.prize_pool,
    'payoutPerWinner', v_payout_per_winner
  );
end;
$$;


-- ============================================================================
-- 6. Function permissions
-- ============================================================================

revoke all on function public.okey_charge_entry_fee(uuid)
  from public, anon, authenticated;

revoke all on function public.okey_configure_match(uuid, numeric, text)
  from public, anon, authenticated;

revoke all on function public.okey_settle_match(uuid, text)
  from public, anon, authenticated;


grant execute on function public.okey_charge_entry_fee(uuid)
  to service_role;

grant execute on function public.okey_configure_match(uuid, numeric, text)
  to service_role;

grant execute on function public.okey_settle_match(uuid, text)
  to service_role;


-- ============================================================================
-- 7. Optional verification queries
-- Run manually after applying the migration.
-- ============================================================================

-- Fun matches must always have zero commission:
-- select
--   id,
--   currency,
--   entry_fee,
--   commission_rate,
--   commission_per_player,
--   total_entry,
--   total_commission,
--   prize_pool
-- from okey.matches
-- where currency = 'fun'
-- order by created_at desc;


-- New Fun matches must not create a house_commission row:
-- select
--   match_id,
--   currency,
--   amount,
--   reason,
--   metadata,
--   created_at
-- from okey.wallet_ledger
-- where currency = 'fun'
--   and reason = 'house_commission'
-- order by created_at desc;


-- Aznif commission audit rows must be marked as burned:
-- select
--   match_id,
--   amount,
--   metadata->>'event' as event,
--   metadata->>'burned' as burned,
--   metadata->>'creditedToWallet' as credited_to_wallet,
--   created_at
-- from okey.wallet_ledger
-- where currency = 'aznif'
--   and reason = 'house_commission'
-- order by created_at desc;