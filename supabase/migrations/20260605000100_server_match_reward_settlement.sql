-- Server-side match reward settlement.
-- Used only by Edge Functions with service_role after a match is finished.
-- Frontend callers should use public.settle_match_rewards(text, uuid).
DROP FUNCTION IF EXISTS public.settle_finished_match_rewards(text, uuid);
CREATE OR REPLACE FUNCTION public.settle_finished_match_rewards(
  p_mode text,
  p_room_id uuid
)
RETURNS TABLE(
  reward_id uuid,
  rewarded_user_id uuid,
  awarded_points integer,
  awarded_gold numeric,
  already_claimed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_state jsonb;
  v_winning_team text;
  v_team_scores jsonb;
  v_winner_score integer;
  v_loser_score integer;
  v_tier text;
  v_gold numeric;
  v_points integer;
  v_player record;
  v_reward_id uuid;
  v_before_gold numeric;
  v_after_gold numeric;
  v_existing_reward_id uuid;
BEGIN
  IF p_mode NOT IN ('1v1', '2v2') THEN
    RAISE EXCEPTION 'Invalid match mode: %', p_mode;
  END IF;

  IF p_mode = '1v1' THEN
    SELECT r.status, r.state
    INTO v_status, v_state
    FROM public.one_vs_one_rooms AS r
    WHERE r.id = p_room_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '1v1 room not found';
    END IF;
  ELSE
    SELECT r.status, r.state
    INTO v_status, v_state
    FROM public.two_vs_two_rooms AS r
    WHERE r.id = p_room_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '2v2 room not found';
    END IF;
  END IF;

  IF v_status <> 'finished' THEN
    RAISE EXCEPTION 'Match is not finished';
  END IF;

  v_winning_team := v_state ->> 'winningTeamId';

  IF v_winning_team NOT IN ('teamA', 'teamB') THEN
    RAISE EXCEPTION 'Finished match has no winning team';
  END IF;

  v_team_scores := COALESCE(v_state -> 'teamScores', '{}'::jsonb);
  v_winner_score := COALESCE((v_team_scores ->> v_winning_team)::int, 0);
  v_loser_score := COALESCE(
    (
      v_team_scores ->> CASE
        WHEN v_winning_team = 'teamA' THEN 'teamB'
        ELSE 'teamA'
      END
    )::int,
    0
  );

  IF v_state ? 'matchReward'
    AND jsonb_typeof(v_state -> 'matchReward') = 'object'
  THEN
    v_tier := COALESCE(v_state #>> '{matchReward,tier}', 'normal');
    v_gold := COALESCE((v_state #>> '{matchReward,gold}')::numeric, 0);
    v_points := COALESCE((v_state #>> '{matchReward,points}')::int, 0);
  ELSE
    SELECT r.tier, r.gold, r.points
    INTO v_tier, v_gold, v_points
    FROM public.calculate_match_reward(
      v_winner_score,
      v_loser_score
    ) AS r;
  END IF;

  IF v_points < 0 OR v_gold < 0 THEN
    RAISE EXCEPTION 'Invalid match reward values';
  END IF;

  FOR v_player IN
    EXECUTE format(
      'SELECT user_id, team_id
       FROM public.%I
       WHERE room_id = $1
         AND team_id = $2
         AND user_id IS NOT NULL
       ORDER BY player_index',
      CASE
        WHEN p_mode = '1v1'
          THEN 'one_vs_one_players'
        ELSE 'two_vs_two_players'
      END
    )
    USING p_room_id, v_winning_team
  LOOP
    v_existing_reward_id := NULL;
    v_reward_id := NULL;

    SELECT r.id
    INTO v_existing_reward_id
    FROM public.match_reward_records AS r
    WHERE r.room_id = p_room_id
      AND r.mode = p_mode
      AND r.user_id = v_player.user_id;

    INSERT INTO public.match_reward_records (
      room_id,
      mode,
      user_id,
      team_id,
      points,
      gold,
      tier,
      metadata
    )
    VALUES (
      p_room_id,
      p_mode,
      v_player.user_id,
      v_player.team_id,
      v_points,
      v_gold,
      v_tier,
      jsonb_build_object(
        'winner_score', v_winner_score,
        'loser_score', v_loser_score,
        'settled_by', 'server'
      )
    )
    ON CONFLICT (room_id, mode, user_id) DO NOTHING
    RETURNING match_reward_records.id
    INTO v_reward_id;

    IF v_reward_id IS NOT NULL THEN
      UPDATE public.profiles AS p
      SET points = COALESCE(p.points, 0) + v_points
      WHERE p.id = v_player.user_id;

      IF v_gold > 0 THEN
        INSERT INTO public.wallets (
          user_id,
          mc,
          gold,
          updated_at
        )
        VALUES (
          v_player.user_id,
          0,
          0,
          now()
        )
        ON CONFLICT (user_id) DO NOTHING;

        SELECT w.gold
        INTO v_before_gold
        FROM public.wallets AS w
        WHERE w.user_id = v_player.user_id
        FOR UPDATE;

        v_after_gold := COALESCE(v_before_gold, 0) + v_gold;

        UPDATE public.wallets AS w
        SET gold = v_after_gold,
            updated_at = now()
        WHERE w.user_id = v_player.user_id;

        INSERT INTO public.wallet_transactions (
          user_id,
          to_user_id,
          amount,
          currency,
          transaction_type,
          status,
          metadata,
          balance_before,
          balance_after
        )
        VALUES (
          v_player.user_id,
          v_player.user_id,
          v_gold,
          'Gold',
          'reward',
          'completed',
          jsonb_build_object(
            'reason', 'match_reward',
            'room_id', p_room_id,
            'mode', p_mode,
            'reward_id', v_reward_id,
            'tier', v_tier
          ),
          COALESCE(v_before_gold, 0),
          v_after_gold
        );
      END IF;

      RETURN QUERY
      SELECT
        v_reward_id,
        v_player.user_id,
        v_points,
        v_gold,
        false;

    ELSE
      RETURN QUERY
      SELECT
        v_existing_reward_id,
        v_player.user_id,
        v_points,
        v_gold,
        true;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_finished_match_rewards(text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_finished_match_rewards(text, uuid)
TO service_role;
