-- ============================================================
-- Fix Disconnect and Timeout Takeover Economy for Domino 2v2 and Okey 4-player
-- ============================================================

-- 1. Domino: Settle all bot takeovers (bot_takeover = true) with -25 points,
--    0 gems, and 0 prize. If currency is 'aznif', record the takeover burn.
CREATE OR REPLACE FUNCTION public.domino_settle_match(
  p_mode text,
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room record;
  v_player record;
  v_winner text;
  v_slots integer;
  v_payout numeric;
  v_before numeric;
  v_after numeric;
  v_points integer;
  v_gems numeric;
  v_result jsonb;
BEGIN
  IF p_mode = '1v1' THEN
    SELECT *
    INTO v_room
    FROM public.one_vs_one_rooms
    WHERE id = p_room_id
    FOR UPDATE;

  ELSIF p_mode = '2v2' THEN
    SELECT *
    INTO v_room
    FROM public.two_vs_two_rooms
    WHERE id = p_room_id
    FOR UPDATE;

  ELSE
    RAISE EXCEPTION 'invalid_match_mode';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  IF v_room.settlement_at IS NOT NULL THEN
    RETURN v_room.settlement;
  END IF;

  IF v_room.status <> 'finished' THEN
    RAISE EXCEPTION 'match_not_finished';
  END IF;

  IF v_room.economy_charged_at IS NULL THEN
    RAISE EXCEPTION 'entry_fee_not_charged';
  END IF;

  v_winner := v_room.state ->> 'winningTeamId';

  IF v_winner NOT IN ('teamA', 'teamB') THEN
    v_result := jsonb_build_object(
      'type', 'no_winner',
      'currency', v_room.currency,
      'entryFeePerPlayer', v_room.entry_fee,
      'totalEntry', v_room.total_entry,
      'totalCommission', v_room.total_commission,
      'prizePool', v_room.prize_pool,
      'payoutPerWinner', 0,
      'refundedPlayers', 0
    );

  ELSE
    v_slots := CASE
      WHEN p_mode = '1v1' THEN 1
      ELSE 2
    END;

    v_payout := round(v_room.prize_pool / v_slots, 2);

    IF round(v_payout * v_slots, 2) <> v_room.prize_pool THEN
      RAISE EXCEPTION 'prize_pool_not_evenly_divisible';
    END IF;

    FOR v_player IN
      EXECUTE format(
        'SELECT user_id, team_id, bot_takeover
         FROM public.%I
         WHERE room_id = $1
           AND user_id IS NOT NULL
         ORDER BY player_index',
        CASE
          WHEN p_mode = '1v1'
            THEN 'one_vs_one_players'
          ELSE 'two_vs_two_players'
        END
      )
      USING p_room_id
    LOOP

      IF v_player.team_id = v_winner THEN
        -- Prize payout.
        -- Taken-over players (bot_takeover = true) never receive the final prize.
        IF NOT v_player.bot_takeover THEN

          IF v_room.currency = 'aznif' THEN
            SELECT mc
            INTO v_before
            FROM public.wallets
            WHERE user_id = v_player.user_id
            FOR UPDATE;

            UPDATE public.wallets
            SET
              mc = mc + v_payout,
              updated_at = now()
            WHERE user_id = v_player.user_id
            RETURNING mc
            INTO v_after;

          ELSE
            SELECT coin
            INTO v_before
            FROM public.wallets
            WHERE user_id = v_player.user_id
            FOR UPDATE;

            UPDATE public.wallets
            SET
              coin = coin + v_payout,
              updated_at = now()
            WHERE user_id = v_player.user_id
            RETURNING coin
            INTO v_after;
          END IF;

          IF v_before IS NULL OR v_after IS NULL THEN
            RAISE EXCEPTION 'wallet_not_initialized';
          END IF;

          INSERT INTO public.domino_wallet_ledger(
            user_id,
            mode,
            room_id,
            currency,
            amount,
            reason,
            idempotency_key,
            metadata
          )
          VALUES(
            v_player.user_id,
            p_mode,
            p_room_id,
            v_room.currency,
            v_payout,
            'prize',
            p_mode || ':' || p_room_id || ':prize:' || v_player.user_id,
            jsonb_build_object(
              'winnerTeamId', v_winner,
              'balanceBefore', v_before,
              'balanceAfter', v_after,
              'payout', v_payout
            )
          );
        ELSE
          -- Bot takeover: Burn the payout and log in ledger to balance with entries.
          IF v_room.currency = 'aznif' AND v_payout > 0 THEN
            INSERT INTO public.domino_wallet_ledger(
              user_id,
              mode,
              room_id,
              currency,
              amount,
              reason,
              idempotency_key,
              metadata
            )
            VALUES(
              NULL,
              p_mode,
              p_room_id,
              v_room.currency,
              v_payout,
              'commission_burn',
              p_mode || ':' || p_room_id || ':takeover-prize-burn:' || v_player.user_id,
              jsonb_build_object(
                'event', 'takeover_prize_burn',
                'burned', true,
                'target_player_id', v_player.user_id,
                'payout', v_payout
              )
            );
          END IF;
        END IF;
      END IF;

      -- Fun Points / Gem settlement.
      -- Taken-over players receive -25 points and 0 gems.
      -- ON CONFLICT DO NOTHING handles manual leavers who were already settled.
      IF v_room.currency = 'fun' THEN

        v_points := CASE
          WHEN v_player.bot_takeover THEN -25
          WHEN v_player.team_id = v_winner THEN 35
          ELSE -15
        END;

        v_gems := CASE
          WHEN NOT v_player.bot_takeover AND v_player.team_id = v_winner THEN 10
          ELSE 0
        END;

        INSERT INTO public.domino_fun_match_rewards(
          mode,
          room_id,
          user_id,
          team_id,
          point_delta,
          gem_delta
        )
        VALUES(
          p_mode,
          p_room_id,
          v_player.user_id,
          v_player.team_id,
          v_points,
          v_gems
        )
        ON CONFLICT DO NOTHING;

        IF FOUND THEN
          UPDATE public.profiles
          SET
            points = greatest(
              0,
              coalesce(points, 0) + v_points
            ),
            updated_at = now()
          WHERE id = v_player.user_id;

          IF NOT FOUND THEN
            RAISE EXCEPTION 'profile_not_initialized';
          END IF;

          IF v_gems > 0 THEN
            UPDATE public.wallets
            SET
              gem = gem + v_gems,
              updated_at = now()
            WHERE user_id = v_player.user_id;

            IF NOT FOUND THEN
              RAISE EXCEPTION 'wallet_not_initialized';
            END IF;
          END IF;
        END IF;
      END IF;

    END LOOP;

    v_result := jsonb_build_object(
      'type', 'winner',
      'currency', v_room.currency,
      'winnerTeamId', v_winner,
      'entryFeePerPlayer', v_room.entry_fee,
      'commissionRate', v_room.commission_rate,
      'commissionPerPlayer', v_room.commission_per_player,
      'totalEntry', v_room.total_entry,
      'totalCommission', v_room.total_commission,
      'commissionBurned',
        v_room.currency = 'aznif'
        AND v_room.total_commission > 0,
      'prizePool', v_room.prize_pool,
      'payoutPerWinner', v_payout
    );
  END IF;

  IF p_mode = '1v1' THEN
    UPDATE public.one_vs_one_rooms
    SET
      settlement_at = now(),
      settlement = v_result
    WHERE id = p_room_id;

  ELSE
    UPDATE public.two_vs_two_rooms
    SET
      settlement_at = now(),
      settlement = v_result
    WHERE id = p_room_id;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.domino_settle_match(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.domino_settle_match(text, uuid) TO service_role;


-- 2. Okey: Settle all bot takeovers (controlledByBot = true) with -25 points,
--    0 gems, and 0 prize. If currency is 'aznif', record the takeover burn.
CREATE OR REPLACE FUNCTION public.okey_settle_match(
  p_match_id uuid,
  p_winner_team_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, okey
AS $$
DECLARE
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
  v_is_bot boolean;
BEGIN
  IF auth.role() <> 'service_role' then
    RAISE EXCEPTION 'service_role_required' USING errcode = '42501';
  END IF;

  IF p_match_id is null then
    RAISE EXCEPTION 'match_id_required' USING errcode = '22023';
  END IF;

  SELECT *
  INTO v_match
  from okey.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found' USING errcode = 'P0002';
  END IF;

  IF v_match.settlement_at is not null then
    IF coalesce(v_match.settlement->>'type', '') in ('winner', 'no_winner') then
      RETURN coalesce(v_match.settlement, '{}'::jsonb);
    END IF;
    RAISE EXCEPTION 'match_already_settled' USING errcode = 'P0001';
  END IF;

  SELECT coalesce(state->'manualLeftPlayerIds', '[]'::jsonb)
  INTO v_manual_left_player_ids
  from okey.match_private_states
  WHERE match_id = p_match_id;

  v_manual_left_player_ids := coalesce(v_manual_left_player_ids, '[]'::jsonb);

  SELECT count(*)
  INTO v_charged_players
  from okey.wallet_ledger
  WHERE match_id = p_match_id
    and reason = 'entry_fee';

  IF v_match.entry_fee > 0 and v_charged_players <> 4 then
    RAISE EXCEPTION 'entry_fee_not_fully_charged' USING errcode = 'P0001';
  END IF;

  -- Treat anyone controlledByBot as non-human for eligibility
  SELECT count(*)
  INTO v_remaining_humans
  from okey.match_seats seat
  WHERE seat.match_id = p_match_id
    and not EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(
        (SELECT state->'players' from okey.match_private_states WHERE match_id = p_match_id)
      ) AS p(id uuid, controlledByBot boolean, kind text)
      WHERE p.id = seat.user_id AND (coalesce(p.controlledByBot, false) OR p.kind = 'bot')
    );

  IF p_winner_team_id is null then
    IF v_remaining_humans <> 0 then
      RAISE EXCEPTION 'no_winner_requires_zero_humans' USING errcode = 'P0001';
    END IF;

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

    UPDATE okey.matches
    SET status = 'finished',
        turn_deadline_at = null,
        settlement_at = now(),
        settlement = v_result,
        updated_at = now()
    WHERE id = p_match_id;

    RETURN v_result;
  END IF;

  IF p_winner_team_id not in ('teamA', 'teamB') then
    RAISE EXCEPTION 'invalid_winner_team' USING errcode = '22023';
  END IF;

  IF v_match.currency = 'fun'
     and (v_match.total_commission <> 0 or v_match.prize_pool <> v_match.total_entry) then
    RAISE EXCEPTION 'invalid_fun_economy_configuration' USING errcode = 'P0001';
  END IF;

  v_payout_per_winner := round(v_match.prize_pool / 2, 2);
  IF round(v_payout_per_winner * 2, 2) <> v_match.prize_pool then
    RAISE EXCEPTION 'prize_pool_not_evenly_divisible' USING errcode = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_eligible_winners
  from okey.match_seats seat
  WHERE seat.match_id = p_match_id
    and seat.team_id = p_winner_team_id
    and not EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(
        (SELECT state->'players' from okey.match_private_states WHERE match_id = p_match_id)
      ) AS p(id uuid, controlledByBot boolean, kind text)
      WHERE p.id = seat.user_id AND (coalesce(p.controlledByBot, false) OR p.kind = 'bot')
    );

  FOR v_seat in
    SELECT *
    from okey.match_seats seat
    WHERE seat.match_id = p_match_id
      and seat.team_id = p_winner_team_id
    ORDER BY seat.player_index
  LOOP
    -- Check if player is bot-controlled
    SELECT coalesce(p.controlledByBot, false) OR (p.kind = 'bot') INTO v_is_bot
    FROM jsonb_to_recordset(
      (SELECT state->'players' from okey.match_private_states WHERE match_id = p_match_id)
    ) AS p(id uuid, controlledByBot boolean, kind text)
    WHERE p.id = v_seat.user_id;

    v_is_bot := coalesce(v_is_bot, false);

    IF NOT v_is_bot THEN
      IF v_match.currency = 'aznif' then
        SELECT mc INTO v_balance_before
        from public.wallets
        WHERE user_id = v_seat.user_id
        FOR UPDATE;

        IF not FOUND then
          RAISE EXCEPTION 'wallet_not_initialized' USING errcode = 'P0001';
        END IF;

        UPDATE public.wallets
        SET mc = mc + v_payout_per_winner, updated_at = now()
        WHERE user_id = v_seat.user_id
        RETURNING mc INTO v_balance_after;
      elsif v_match.currency = 'fun' then
        SELECT coin into v_balance_before
        from public.wallets
        WHERE user_id = v_seat.user_id
        FOR UPDATE;

        IF not FOUND then
          RAISE EXCEPTION 'wallet_not_initialized' USING errcode = 'P0001';
        END IF;

        UPDATE public.wallets
        SET coin = coin + v_payout_per_winner, updated_at = now()
        WHERE user_id = v_seat.user_id
        RETURNING coin into v_balance_after;
      else
        RAISE EXCEPTION 'invalid_match_currency' USING errcode = '22023';
      END IF;

      INSERT INTO okey.wallet_ledger (
        user_id, match_id, currency, amount, reason, idempotency_key, metadata
      )
      VALUES (
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
    ELSE
      -- Bot takeover: Burn the payout and log in ledger as house_commission to balance with entries.
      IF v_match.currency = 'aznif' AND v_payout_per_winner > 0 THEN
        INSERT INTO okey.wallet_ledger (
          user_id,
          match_id,
          currency,
          amount,
          reason,
          idempotency_key,
          metadata
        )
        VALUES (
          NULL,
          p_match_id,
          v_match.currency,
          v_payout_per_winner,
          'house_commission',
          p_match_id::text || ':takeover-prize-burn:' || v_seat.user_id::text,
          jsonb_build_object(
            'event', 'takeover_prize_burn',
            'burned', true,
            'target_player_id', v_seat.user_id,
            'payout', v_payout_per_winner
          )
        );
      END IF;
    END IF;
  END LOOP;

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

  UPDATE okey.matches
  SET status = 'finished',
      turn_deadline_at = null,
      settlement_at = now(),
      settlement = v_result,
      updated_at = now()
  WHERE id = p_match_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.okey_settle_match(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.okey_settle_match(uuid, text) TO service_role;


CREATE OR REPLACE FUNCTION okey.apply_fun_match_rewards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, okey
AS $$
DECLARE
  v_winner_team_id text;
  v_seat okey.match_seats%rowtype;
  v_points_before integer;
  v_point_delta integer;
  v_gem_delta numeric(20,2);
  v_is_bot boolean;
BEGIN
  IF old.settlement_at is not null
     or new.settlement_at is null
     or new.status <> 'finished'
     or new.currency <> 'fun'
     or coalesce(new.settlement->>'type', '') <> 'winner' then
    RETURN new;
  END IF;

  v_winner_team_id := new.settlement->>'winnerTeamId';
  IF v_winner_team_id not in ('teamA', 'teamB') then
    RAISE EXCEPTION 'invalid_fun_winner_team';
  END IF;

  FOR v_seat in
    SELECT *
    from okey.match_seats
    where match_id = new.id
    ORDER BY player_index
  LOOP
    -- Check if player is bot-controlled
    SELECT coalesce(p.controlledByBot, false) OR (p.kind = 'bot') INTO v_is_bot
    FROM jsonb_to_recordset(
      (SELECT state->'players' from okey.match_private_states WHERE match_id = new.id)
    ) AS p(id uuid, controlledByBot boolean, kind text)
    WHERE p.id = v_seat.user_id;

    v_is_bot := coalesce(v_is_bot, false);

    v_point_delta := case
      WHEN v_is_bot then -25
      WHEN v_seat.team_id = v_winner_team_id then 35
      else -15
    END;

    v_gem_delta := case
      WHEN not v_is_bot and v_seat.team_id = v_winner_team_id then 10
      else 0
    END;

    INSERT INTO okey.fun_match_rewards (
      match_id, user_id, team_id, point_delta, gem_delta
    )
    VALUES (
      new.id, v_seat.user_id, v_seat.team_id, v_point_delta, v_gem_delta
    )
    on conflict (match_id, user_id) do nothing;

    IF not FOUND then
      CONTINUE;
    END IF;

    SELECT coalesce(points, 0)
    INTO v_points_before
    from public.profiles
    WHERE id = v_seat.user_id
    FOR UPDATE;

    IF not FOUND then
      RAISE EXCEPTION 'profile_not_initialized';
    END IF;

    UPDATE public.profiles
    SET points = greatest(0, v_points_before + v_point_delta),
        updated_at = now()
    WHERE id = v_seat.user_id;

    IF v_gem_delta > 0 then
      UPDATE public.wallets
      SET gem = gem + v_gem_delta, updated_at = now()
      WHERE user_id = v_seat.user_id;

      IF not FOUND then
        RAISE EXCEPTION 'wallet_not_initialized';
      END IF;
    END IF;
  END LOOP;

  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION okey.apply_fun_match_rewards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION okey.apply_fun_match_rewards() TO service_role;

NOTIFY pgrst, 'reload schema';
