-- Fix Domino Fun 2v2 manual-leave double settlement.
--
-- Rule:
-- A player who manually leaves a Fun 2v2 match is already settled by
-- settle_free_two_vs_two_manual_forfeit():
--   -25 Points
--   +1 games_played
--   +1 games_lost
--
-- That player must NOT receive any additional final Fun reward/penalty
-- when the room later finishes.
--
-- In particular:
--   no extra -15 Points
--   no +35 Points
--   no +10 Gem
--
-- Entry fee / prize payout logic is unchanged.

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
  v_left boolean;
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
        'SELECT user_id, team_id
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

      EXECUTE format(
        'SELECT EXISTS(
           SELECT 1
           FROM public.%I
           WHERE room_id = $1
             AND player_id = $2
             AND action = ''manual_leave_takeover''
         )',
        CASE
          WHEN p_mode = '1v1'
            THEN 'one_vs_one_moves'
          ELSE 'two_vs_two_moves'
        END
      )
      INTO v_left
      USING p_room_id, v_player.user_id;


      -- Prize payout.
      -- Manual-leave players never receive the final prize.
      IF v_player.team_id = v_winner
         AND NOT v_left
      THEN

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
      END IF;


      /*
       * Fun Points / Gem settlement.
       *
       * IMPORTANT:
       * A manual-leave player in 2v2 has already been settled by
       * settle_free_two_vs_two_manual_forfeit().
       *
       * Do NOT settle that player again here.
       */
      IF v_room.currency = 'fun'
         AND NOT (
           p_mode = '2v2'
           AND v_left
         )
      THEN

        v_points := CASE
          WHEN v_player.team_id = v_winner THEN 35
          ELSE -15
        END;

        v_gems := CASE
          WHEN v_player.team_id = v_winner THEN 10
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


-- Keep the settlement function private.
REVOKE ALL
ON FUNCTION public.domino_settle_match(text, uuid)
FROM PUBLIC, anon, authenticated;