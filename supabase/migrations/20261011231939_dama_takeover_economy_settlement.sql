-- Match Domino/Okey Fun settlement: a seat still controlled by a Bot at
-- settlement time is not eligible for a prize, gems, or winner points.
-- Restoring the seat before match completion clears both flags and restores
-- normal winner rewards.
CREATE OR REPLACE FUNCTION public.dama_settle_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.dama_matches%ROWTYPE;
  v_economy public.dama_match_economy%ROWTYPE;
  v_player record;
  v_winner uuid;
  v_winner_eligible boolean := false;
  v_before numeric;
  v_after numeric;
  v_points integer;
  v_gems numeric(20,2);
  v_reward_inserted boolean;
  v_result jsonb;
BEGIN
  SELECT * INTO STRICT v_match
  FROM public.dama_matches
  WHERE id = p_match_id
  FOR UPDATE;

  SELECT * INTO STRICT v_economy
  FROM public.dama_match_economy
  WHERE match_id = p_match_id
  FOR UPDATE;

  IF v_economy.settled_at IS NOT NULL THEN
    RETURN v_economy.settlement;
  END IF;
  IF v_match.status <> 'finished' THEN
    RAISE EXCEPTION 'dama_match_not_finished';
  END IF;
  IF v_economy.charged_at IS NULL THEN
    RAISE EXCEPTION 'dama_entry_not_charged';
  END IF;

  v_winner := v_match.winner_user_id;
  IF v_winner IS NULL THEN
    -- Preserve the existing no-winner contract. A draw or both-Bot finish
    -- does not grant rank rewards or an uncontracted refund.
    v_result := jsonb_build_object(
      'type', 'no_winner', 'currency', 'coin',
      'entryFeePerPlayer', 500, 'totalEntry', 1000,
      'commission', 0, 'payout', 0, 'refund', 0,
      'netCoinDelta', -500, 'pointDelta', 0, 'gemDelta', 0,
      'reason', v_match.finish_reason
    );
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.dama_match_players p
      WHERE p.match_id = p_match_id
        AND p.user_id = v_winner
        AND p.left_at IS NULL
        AND NOT p.bot_takeover
        AND NOT p.manual_left
    ) INTO v_winner_eligible;

    FOR v_player IN
      SELECT user_id, piece_color, bot_takeover, manual_left
      FROM public.dama_match_players
      WHERE match_id = p_match_id
        AND user_id IS NOT NULL
        AND left_at IS NULL
      ORDER BY user_id
      FOR UPDATE
    LOOP
      IF v_player.bot_takeover OR v_player.manual_left THEN
        v_points := -25;
        v_gems := 0;
      ELSIF v_player.user_id = v_winner THEN
        v_points := 35;
        v_gems := 10;
      ELSE
        v_points := -15;
        v_gems := 0;
      END IF;

      -- A Bot may win the board, but its absent owner receives no payout.
      IF v_player.user_id = v_winner
         AND NOT v_player.bot_takeover
         AND NOT v_player.manual_left THEN
        SELECT coin INTO v_before
        FROM public.wallets
        WHERE user_id = v_player.user_id
        FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'wallet_not_initialized';
        END IF;

        UPDATE public.wallets
        SET coin = coin + 1000, updated_at = clock_timestamp()
        WHERE user_id = v_player.user_id
        RETURNING coin INTO v_after;

        INSERT INTO public.dama_wallet_ledger(
          match_id, user_id, amount, reason, idempotency_key, metadata
        ) VALUES (
          p_match_id, v_player.user_id, 1000, 'prize',
          'dama:' || p_match_id || ':prize:' || v_player.user_id,
          jsonb_build_object(
            'balanceBefore', v_before,
            'balanceAfter', v_after,
            'payout', 1000
          )
        );
      END IF;

      INSERT INTO public.dama_fun_match_rewards(
        match_id, user_id, piece_color, point_delta, gem_delta
      ) VALUES (
        p_match_id, v_player.user_id, v_player.piece_color, v_points, v_gems
      ) ON CONFLICT (match_id, user_id) DO NOTHING;

      v_reward_inserted := FOUND;
      IF v_reward_inserted THEN
        UPDATE public.profiles
        SET points = GREATEST(0, COALESCE(points, 0) + v_points),
            updated_at = clock_timestamp()
        WHERE id = v_player.user_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'profile_not_initialized';
        END IF;

        IF v_gems > 0 THEN
          UPDATE public.wallets
          SET gem = gem + v_gems, updated_at = clock_timestamp()
          WHERE user_id = v_player.user_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'wallet_not_initialized';
          END IF;
        END IF;
      END IF;
    END LOOP;

    v_result := jsonb_build_object(
      'type', 'winner', 'currency', 'coin',
      'winnerUserId', v_winner,
      'entryFeePerPlayer', 500, 'totalEntry', 1000,
      'commission', 0, 'payout', CASE WHEN v_winner_eligible THEN 1000 ELSE 0 END,
      'eligibleWinnerCount', CASE WHEN v_winner_eligible THEN 1 ELSE 0 END,
      'netCoinDelta', CASE WHEN v_winner_eligible THEN 500 ELSE -500 END,
      'winnerPointDelta', 35, 'winnerGemDelta', 10,
      'loserPointDelta', -15, 'loserGemDelta', 0,
      'takeoverPointDelta', -25, 'takeoverGemDelta', 0
    );
  END IF;

  UPDATE public.dama_match_economy
  SET settled_at = clock_timestamp(), settlement = v_result
  WHERE match_id = p_match_id;
  UPDATE public.dama_matches
  SET settlement = v_result, settlement_at = clock_timestamp()
  WHERE id = p_match_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION multiplayer_private.record_dama_final_stats(
  p_match_id uuid,
  p_manual_leaver uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match public.dama_matches%ROWTYPE;
  v_results jsonb;
BEGIN
  SELECT * INTO v_match
  FROM public.dama_matches
  WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'finished' THEN
    RETURN;
  END IF;
  IF v_match.winner_user_id IS NULL
     AND v_match.finish_reason <> 'both-bot-takeover' THEN
    RETURN;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', p.user_id,
    'team_id', CASE WHEN p.piece_color = 'cream' THEN 'teamA' ELSE 'teamB' END,
    'outcome', CASE
      WHEN p.bot_takeover OR p.manual_left THEN 'loss'
      WHEN p.user_id = v_match.winner_user_id THEN 'win'
      ELSE 'loss'
    END,
    'reason', CASE
      WHEN p.manual_left THEN 'manual_leave'
      ELSE 'match_finished'
    END
  )), '[]'::jsonb)
  INTO v_results
  FROM public.dama_match_players p
  WHERE p.match_id = p_match_id
    AND p.user_id IS NOT NULL
    AND p.left_at IS NULL;

  PERFORM multiplayer_private.record_player_results(
    'dama', p_match_id, v_match.version, NULL, v_results
  );
END;
$$;

-- Manual leave remains restorable until the match ends. Record the outcome
-- only at final settlement, after we know whether the player reclaimed control.
CREATE OR REPLACE FUNCTION public.dama_leave_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_bots integer;
  v_version bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status
  FROM public.dama_matches
  WHERE id = p_match_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dama_match_not_found';
  END IF;

  PERFORM 1
  FROM public.dama_match_players
  WHERE match_id = p_match_id AND user_id = v_uid AND left_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dama_membership_required' USING ERRCODE = '42501';
  END IF;

  IF v_status = 'waiting' THEN
    UPDATE public.dama_match_players
    SET bot_takeover = true, connected = false, left_at = clock_timestamp()
    WHERE match_id = p_match_id AND user_id = v_uid;
    UPDATE public.dama_matches
    SET status = 'cancelled', version = version + 1, updated_at = clock_timestamp()
    WHERE id = p_match_id AND status = 'waiting';
  ELSIF v_status = 'active' THEN
    UPDATE public.dama_match_players
    SET bot_takeover = true, manual_left = true, connected = false
    WHERE match_id = p_match_id AND user_id = v_uid;

    SELECT count(*) INTO v_bots
    FROM public.dama_match_players
    WHERE match_id = p_match_id AND bot_takeover AND left_at IS NULL;

    IF v_bots = 2 THEN
      UPDATE public.dama_matches
      SET status = 'finished', current_turn_user_id = NULL,
          winner_user_id = NULL, finish_reason = 'both-bot-takeover',
          state = jsonb_set(
            jsonb_set(COALESCE(state, '{}'::jsonb), '{result}',
              jsonb_build_object('winner', NULL, 'reason', 'both-bot-takeover'), true),
            '{turnDeadlineAtMs}', 'null'::jsonb, true
          ),
          version = version + 1, updated_at = clock_timestamp()
      WHERE id = p_match_id AND status = 'active'
      RETURNING version INTO v_version;

      INSERT INTO public.dama_match_moves(match_id, version, user_id, action, payload)
      VALUES (p_match_id, v_version, v_uid, 'manual-leave', jsonb_build_object('bot_takeover', true));
      PERFORM public.dama_settle_match(p_match_id);
      PERFORM multiplayer_private.record_dama_final_stats(p_match_id);
    ELSE
      UPDATE public.dama_matches
      SET version = version + 1, updated_at = clock_timestamp()
      WHERE id = p_match_id AND status = 'active'
      RETURNING version INTO v_version;

      INSERT INTO public.dama_match_moves(match_id, version, user_id, action, payload)
      VALUES (p_match_id, v_version, v_uid, 'manual-leave', jsonb_build_object('bot_takeover', true));
      -- Keep this seat and membership resumable; final stats and economy wait
      -- until a restore or terminal match result.
    END IF;
  ELSE
    RAISE EXCEPTION 'dama_match_not_active';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.dama_settle_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dama_settle_match(uuid) TO service_role;
REVOKE ALL ON FUNCTION multiplayer_private.record_dama_final_stats(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION multiplayer_private.record_dama_final_stats(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.dama_leave_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dama_leave_match(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
