-- ============================================================================
-- Okey cancellation and full refund
--
-- Responsibility:
--   - cancel one unsettled Okey match
--   - refund the full charged entry fee to every charged player
--   - reverse the Aznif commission-burn audit entry
--   - finalize the match as cancelled
--
-- Economy rules:
--   - fun:   no commission and no commission reversal
--   - aznif: commission is burned; cancellation reverses that burn in audit
--
-- This migration assumes these objects already exist:
--   - okey.matches
--   - okey.wallet_ledger
--   - public.wallets
-- ============================================================================


create or replace function public.okey_cancel_match_and_refund(
  p_match_id uuid,
  p_cancel_reason text default 'match_cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, okey
as $$
declare
  v_match okey.matches%rowtype;
  v_entry record;

  v_charged_players integer := 0;
  v_refunded_players integer := 0;

  v_refund_amount numeric(20,2);
  v_balance_before numeric(20,2);
  v_balance_after numeric(20,2);

  v_cancel_reason text;
  v_result jsonb;
begin
  -- --------------------------------------------------------------------------
  -- Security and input validation
  -- --------------------------------------------------------------------------

  if auth.role() <> 'service_role' then
    raise exception 'service_role_required'
      using errcode = '42501';
  end if;

  if p_match_id is null then
    raise exception 'match_id_required'
      using errcode = '22023';
  end if;

  v_cancel_reason :=
    left(
      coalesce(
        nullif(trim(p_cancel_reason), ''),
        'match_cancelled'
      ),
      200
    );


  -- --------------------------------------------------------------------------
  -- Lock match and protect settlement idempotency
  -- --------------------------------------------------------------------------

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
    if coalesce(v_match.settlement->>'type', '') = 'refund' then
      return coalesce(v_match.settlement, '{}'::jsonb);
    end if;

    raise exception 'match_already_settled'
      using errcode = 'P0001';
  end if;

  if v_match.status not in ('waiting', 'playing') then
    raise exception 'match_not_cancellable'
      using errcode = 'P0001';
  end if;


  -- --------------------------------------------------------------------------
  -- Validate charged entry-fee records
  -- --------------------------------------------------------------------------

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

  if v_match.entry_fee = 0
     and v_charged_players <> 0 then
    raise exception 'unexpected_entry_fee_records'
      using errcode = 'P0001';
  end if;


  -- --------------------------------------------------------------------------
  -- Full refund
  --
  -- Refund from ledger records rather than current seats so the exact users
  -- originally charged are refunded even if room presence later changed.
  -- --------------------------------------------------------------------------

  for v_entry in
    select
      ledger.user_id,
      ledger.amount,
      ledger.metadata
    from okey.wallet_ledger ledger
    where ledger.match_id = p_match_id
      and ledger.reason = 'entry_fee'
    order by ledger.created_at, ledger.id
  loop
    if v_entry.user_id is null then
      raise exception 'charged_entry_missing_user'
        using errcode = 'P0001';
    end if;

    v_refund_amount := round(abs(v_entry.amount), 2);

    if v_refund_amount <= 0 then
      raise exception 'invalid_charged_entry_amount'
        using errcode = 'P0001';
    end if;


    -- ------------------------------------------------------------------------
    -- Aznif / MC
    -- ------------------------------------------------------------------------

    if v_match.currency = 'aznif' then
      select mc
      into v_balance_before
      from public.wallets
      where user_id = v_entry.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized'
          using errcode = 'P0001';
      end if;

      update public.wallets
      set
        mc = mc + v_refund_amount,
        updated_at = now()
      where user_id = v_entry.user_id
      returning mc
      into v_balance_after;


    -- ------------------------------------------------------------------------
    -- Fun / Coin
    -- ------------------------------------------------------------------------

    elsif v_match.currency = 'fun' then
      select coin
      into v_balance_before
      from public.wallets
      where user_id = v_entry.user_id
      for update;

      if not found then
        raise exception 'wallet_not_initialized'
          using errcode = 'P0001';
      end if;

      update public.wallets
      set
        coin = coin + v_refund_amount,
        updated_at = now()
      where user_id = v_entry.user_id
      returning coin
      into v_balance_after;

    else
      raise exception 'invalid_match_currency'
        using errcode = 'P0001';
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
      v_entry.user_id,
      p_match_id,
      v_match.currency,
      v_refund_amount,
      'refund',
      p_match_id::text
        || ':refund:'
        || v_entry.user_id::text,
      jsonb_build_object(
        'balanceBefore', v_balance_before,
        'balanceAfter', v_balance_after,
        'refundAmount', v_refund_amount,
        'reason', v_cancel_reason,
        'source', 'cancellation_full_refund'
      )
    );

    v_refunded_players := v_refunded_players + 1;
  end loop;


  -- --------------------------------------------------------------------------
  -- Reverse Aznif commission burn in audit
  --
  -- No treasury wallet exists. The negative audit entry records that the
  -- previously burned commission is undone because the full entries returned.
  -- Fun never enters this branch.
  -- --------------------------------------------------------------------------

  if v_match.currency = 'aznif'
     and v_match.total_commission > 0
     and exists (
       select 1
       from okey.wallet_ledger ledger
       where ledger.match_id = p_match_id
         and ledger.reason = 'house_commission'
         and ledger.amount > 0
     ) then

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
      -v_match.total_commission,
      'house_commission',
      p_match_id::text || ':commission-burn-reversal',
      jsonb_build_object(
        'reversal', true,
        'burned', false,
        'reason', v_cancel_reason,
        'totalCommission', v_match.total_commission,
        'source', 'cancellation_full_refund'
      )
    );
  end if;


  -- --------------------------------------------------------------------------
  -- Finalize cancellation
  -- --------------------------------------------------------------------------

  v_result := jsonb_build_object(
    'type', 'refund',
    'currency', v_match.currency,
    'reason', v_cancel_reason,
    'refundPerPlayer', v_match.entry_fee,
    'refundedPlayers', v_refunded_players,
    'totalRefund',
      case
        when v_match.entry_fee = 0 then 0
        else round(v_match.entry_fee * v_refunded_players, 2)
      end,
    'commissionReversed',
      case
        when v_match.currency = 'aznif'
          then v_match.total_commission
        else 0
      end
  );

  update okey.matches
  set
    status = 'cancelled',
    turn_deadline_at = null,
    countdown_deadline_at = null,
    settlement_at = now(),
    settlement = v_result,
    updated_at = now()
  where id = p_match_id;

  return v_result;
end;
$$;


revoke all on function public.okey_cancel_match_and_refund(uuid, text)
  from public, anon, authenticated;

grant execute on function public.okey_cancel_match_and_refund(uuid, text)
  to service_role;