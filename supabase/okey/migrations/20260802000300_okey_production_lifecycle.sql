-- ============================================================================
-- Okey production lifecycle
-- Uses the application's central wallet:
--   Okey "aznif" -> public.wallets.mc
--   Okey "fun"   -> public.wallets.coin
--
-- No Domino object is referenced.
-- No separate Okey wallet or treasury wallet is created.
-- ============================================================================


-- ============================================================================
-- 1. Match economy
-- ============================================================================

alter table okey.matches
  add column if not exists entry_fee numeric(20,2) not null default 0
    check (entry_fee >= 0),

  add column if not exists currency text not null default 'fun'
    check (currency in ('fun', 'aznif')),

  add column if not exists commission_rate numeric(6,5) not null default 0.05
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


alter table okey.match_seats
  add column if not exists bot_since timestamptz,

  add column if not exists bot_difficulty text
    check (bot_difficulty in ('easy', 'normal', 'hard'));


-- ============================================================================
-- 2. Okey audit ledger
--
-- This is NOT a wallet.
-- Real balances stay in public.wallets.
--
-- Ledger signs:
--   entry_fee       negative
--   house_commission positive
--   prize           positive
--   refund          positive
--   commission reversal negative
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


-- ============================================================================
-- 3. Okey match chat
-- ============================================================================

create table if not exists okey.match_chat_messages (
  id uuid primary key default gen_random_uuid(),

  match_id uuid not null
    references okey.matches(id) on delete cascade,

  user_id uuid not null
    references auth.users(id) on delete cascade,

  body text not null
    check (char_length(body) between 1 and 500),

  created_at timestamptz not null default now()
);


create index if not exists okey_match_chat_messages_match_created_idx
  on okey.match_chat_messages(match_id, created_at);


alter table okey.wallet_ledger enable row level security;
alter table okey.match_chat_messages enable row level security;


revoke all on table okey.wallet_ledger
  from public, anon, authenticated;

revoke all on table okey.match_chat_messages
  from public, anon, authenticated;


grant select, insert, update, delete
  on table okey.wallet_ledger
  to service_role;

grant select, insert, update, delete
  on table okey.match_chat_messages
  to service_role;


-- ============================================================================
-- 4. Configure and lock match economy
--
-- Rule:
--   4 players
--   5% commission from each player's entry
--   95% enters the Prize Pool
--   Prize Pool is paid equally to exactly 2 winners
--
-- Example: 10 Aznif
--   entry per player       = 10.00
--   commission per player  = 0.50
--   total entry            = 40.00
--   total commission       = 2.00
--   prize pool             = 38.00
--   payout per winner      = 19.00
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
  v_commission_rate numeric(6,5) := 0.05;
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
    raise exception 'match_id_required';
  end if;

  if p_entry_fee is null or p_entry_fee < 0 then
    raise exception 'invalid_entry_fee';
  end if;

  if p_currency not in ('fun', 'aznif') then
    raise exception 'invalid_match_currency';
  end if;

  v_entry_fee :=
    round(p_entry_fee::numeric, 2);

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
    currency = p_currency,
    commission_rate = v_commission_rate,
    commission_per_player = v_commission_per_player,
    total_entry = v_total_entry,
    total_commission = v_total_commission,
    prize_pool = v_prize_pool
  where id = p_match_id
    and status = 'waiting'
    and settlement_at is null;

  if not found then
    raise exception 'match_not_waiting';
  end if;
end;
$$;


-- ============================================================================
-- 5. Charge all four players from the central wallet
--
-- Aznif:
--   public.wallets.mc
--
-- Fun:
--   public.wallets.coin
--
-- The match row is locked, so concurrent retries cannot charge twice.
-- If any player has insufficient balance, the complete transaction rolls back.
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

  select *
  into v_match
  from okey.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found';
  end if;

  if v_match.status <> 'waiting' then
    raise exception 'match_not_waiting';
  end if;

  if v_match.entry_fee = 0 then
    return jsonb_build_object(
      'charged', false,
      'reason', 'free_match'
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
      'entryFeePerPlayer', v_match.entry_fee,
      'commissionPerPlayer', v_match.commission_per_player,
      'totalEntry', v_match.total_entry,
      'totalCommission', v_match.total_commission,
      'prizePool', v_match.prize_pool
    );
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
    raise exception 'match_requires_four_unique_players';
  end if;

  for v_seat in
    select *
    from okey.match_seats
    where match_id = p_match_id
    order by player_index
  loop

    if v_seat.user_id is null then
      raise exception 'seat_missing_user';
    end if;


    -- ------------------------------------------------------------------------
    -- Aznif / MC
    -- ------------------------------------------------------------------------

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


    -- ------------------------------------------------------------------------
    -- Fun / Coin
    -- ------------------------------------------------------------------------

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
      raise exception 'invalid_match_currency';
    end if;


    -- Full entry debit audit record
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
            v_match.entry_fee
            - v_match.commission_per_player,
            2
          )
      )
    );

  end loop;


  -- One audit record for total house commission.
  -- The money has already been removed from the four central wallets.
  -- No separate Okey treasury wallet is created.
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
    v_match.currency,
    v_match.total_commission,
    'house_commission',
    p_match_id::text || ':house-commission',
    jsonb_build_object(
      'commissionRate', v_match.commission_rate,
      'commissionPerPlayer', v_match.commission_per_player,
      'playerCount', 4,
      'totalCommission', v_match.total_commission
    )
  );

  return jsonb_build_object(
    'charged', true,
    'currency', v_match.currency,
    'entryFeePerPlayer', v_match.entry_fee,
    'commissionRate', v_match.commission_rate,
    'commissionPerPlayer', v_match.commission_per_player,
    'totalEntry', v_match.total_entry,
    'totalCommission', v_match.total_commission,
    'prizePool', v_match.prize_pool
  );
end;
$$;


-- ============================================================================
-- 6. Settle match
--
-- Winner:
--   Prize Pool is split equally between exactly two team members.
--
-- Cancellation:
--   Each player receives the complete entry fee back.
--   House commission is reversed in the Okey audit ledger.
--
-- settlement_at makes this operation idempotent.
-- ============================================================================

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

  select *
  into v_match
  from okey.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found';
  end if;

  if v_match.settlement_at is not null then
    return coalesce(
      v_match.settlement,
      '{}'::jsonb
    );
  end if;

  select count(*)
  into v_charged_players
  from okey.wallet_ledger
  where match_id = p_match_id
    and reason = 'entry_fee';

  if v_match.entry_fee > 0
     and v_charged_players <> 4 then
    raise exception 'entry_fee_not_fully_charged';
  end if;


  -- ==========================================================================
  -- Cancellation / full refund
  -- ==========================================================================

  if p_winner_team_id is null then

    for v_seat in
      select *
      from okey.match_seats
      where match_id = p_match_id
      order by player_index
    loop

      if v_match.currency = 'aznif' then

        select mc
        into v_balance_before
        from public.wallets
        where user_id = v_seat.user_id
        for update;

        if not found then
          raise exception 'wallet_not_initialized';
        end if;

        update public.wallets
        set
          mc = mc + v_match.entry_fee,
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
          raise exception 'wallet_not_initialized';
        end if;

        update public.wallets
        set
          coin = coin + v_match.entry_fee,
          updated_at = now()
        where user_id = v_seat.user_id
        returning coin
        into v_balance_after;

      else
        raise exception 'invalid_match_currency';
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
        v_match.entry_fee,
        'refund',
        p_match_id::text
          || ':refund:'
          || v_seat.user_id::text,
        jsonb_build_object(
          'balanceBefore', v_balance_before,
          'balanceAfter', v_balance_after,
          'refundAmount', v_match.entry_fee,
          'reason', 'match_cancelled'
        )
      );

    end loop;


    -- Reverse house commission in audit ledger.
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
      v_match.currency,
      -v_match.total_commission,
      'house_commission',
      p_match_id::text || ':house-commission-reversal',
      jsonb_build_object(
        'reversal', true,
        'reason', 'match_cancelled',
        'totalCommission', v_match.total_commission
      )
    );


    update okey.matches
    set
      status = 'cancelled',
      settlement_at = now(),
      settlement = jsonb_build_object(
        'type', 'refund',
        'currency', v_match.currency,
        'refundPerPlayer', v_match.entry_fee,
        'totalRefund', v_match.total_entry,
        'commissionReversed', v_match.total_commission
      )
    where id = p_match_id;


    return jsonb_build_object(
      'type', 'refund',
      'currency', v_match.currency,
      'refundPerPlayer', v_match.entry_fee,
      'totalRefund', v_match.total_entry,
      'commissionReversed', v_match.total_commission
    );

  end if;


  -- ==========================================================================
  -- Winner settlement
  -- ==========================================================================

  if p_winner_team_id not in ('teamA', 'teamB') then
    raise exception 'invalid_winner_team';
  end if;

  select count(*)
  into v_winners
  from okey.match_seats
  where match_id = p_match_id
    and team_id = p_winner_team_id;

  if v_winners <> 2 then
    raise exception 'winning_team_must_have_two_players';
  end if;

  v_payout_per_winner :=
    round(v_match.prize_pool / 2, 2);

  if round(v_payout_per_winner * 2, 2)
     <> v_match.prize_pool then
    raise exception 'prize_pool_not_evenly_divisible';
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
        raise exception 'wallet_not_initialized';
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
        raise exception 'wallet_not_initialized';
      end if;

      update public.wallets
      set
        coin = coin + v_payout_per_winner,
        updated_at = now()
      where user_id = v_seat.user_id
      returning coin
      into v_balance_after;

    else
      raise exception 'invalid_match_currency';
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
      'prizePool', v_match.prize_pool,
      'payoutPerWinner', v_payout_per_winner
    )
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
    'prizePool', v_match.prize_pool,
    'payoutPerWinner', v_payout_per_winner
  );
end;
$$;


-- ============================================================================
-- 7. Match chat
-- ============================================================================

create or replace function public.okey_post_chat_message(
  p_match_id uuid,
  p_user_id uuid,
  p_body text
)
returns okey.match_chat_messages
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_message okey.match_chat_messages%rowtype;
  v_body text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from okey.match_seats
    where match_id = p_match_id
      and user_id = p_user_id
  ) then
    raise exception 'not_a_participant'
      using errcode = '42501';
  end if;

  v_body :=
    left(
      trim(
        coalesce(p_body, '')
      ),
      500
    );

  if char_length(v_body) = 0 then
    raise exception 'empty_message';
  end if;

  insert into okey.match_chat_messages (
    match_id,
    user_id,
    body
  )
  values (
    p_match_id,
    p_user_id,
    v_body
  )
  returning *
  into v_message;

  return v_message;
end;
$$;


-- ============================================================================
-- 8. Function permissions
-- ============================================================================

revoke all on function public.okey_charge_entry_fee(uuid)
  from public, anon, authenticated;

revoke all on function public.okey_configure_match(uuid, numeric, text)
  from public, anon, authenticated;

revoke all on function public.okey_settle_match(uuid, text)
  from public, anon, authenticated;

revoke all on function public.okey_post_chat_message(uuid, uuid, text)
  from public, anon, authenticated;


grant execute on function public.okey_charge_entry_fee(uuid)
  to service_role;

grant execute on function public.okey_configure_match(uuid, numeric, text)
  to service_role;

grant execute on function public.okey_settle_match(uuid, text)
  to service_role;

grant execute on function public.okey_post_chat_message(uuid, uuid, text)
  to service_role;