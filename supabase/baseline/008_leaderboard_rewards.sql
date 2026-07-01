-- Domino v1 baseline: leaderboard and rewards.
-- Prerequisites: profiles, wallets, wallet_transactions, and multiplayer room/player tables.

CREATE TABLE IF NOT EXISTS public.match_reward_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('1v1', '2v2')),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id text NOT NULL CHECK (team_id IN ('teamA', 'teamB')),
  points integer NOT NULL CHECK (points >= 0),
  gold numeric NOT NULL DEFAULT 0 CHECK (gold >= 0),
  tier text NOT NULL DEFAULT 'normal',
  source text NOT NULL DEFAULT 'match_settlement',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, mode, user_id)
);

CREATE INDEX IF NOT EXISTS idx_match_reward_records_user_created
ON public.match_reward_records(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_reward_records_room_mode
ON public.match_reward_records(room_id, mode);

ALTER TABLE public.match_reward_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_reward_records_select_own" ON public.match_reward_records;
CREATE POLICY "match_reward_records_select_own"
ON public.match_reward_records
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "match_reward_records_insert_denied" ON public.match_reward_records;
CREATE POLICY "match_reward_records_insert_denied"
ON public.match_reward_records
FOR INSERT
TO authenticated
WITH CHECK (false);

DROP POLICY IF EXISTS "match_reward_records_update_denied" ON public.match_reward_records;
CREATE POLICY "match_reward_records_update_denied"
ON public.match_reward_records
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "match_reward_records_delete_denied" ON public.match_reward_records;
CREATE POLICY "match_reward_records_delete_denied"
ON public.match_reward_records
FOR DELETE
TO authenticated
USING (false);

GRANT SELECT ON public.match_reward_records TO authenticated;

CREATE TABLE IF NOT EXISTS public.ai_practice_reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_match_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points integer NOT NULL DEFAULT 1 CHECK (points = 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_match_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_practice_reward_claims_user_created
ON public.ai_practice_reward_claims (
  user_id,
  created_at DESC
);

ALTER TABLE public.ai_practice_reward_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_practice_reward_claims_select_own"
ON public.ai_practice_reward_claims;

CREATE POLICY "ai_practice_reward_claims_select_own"
ON public.ai_practice_reward_claims
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

GRANT SELECT ON public.ai_practice_reward_claims TO authenticated;

CREATE OR REPLACE FUNCTION public.award_ai_practice_win(
  p_practice_match_id text
)
RETURNS TABLE(
  claim_id uuid,
  rewarded_user_id uuid,
  awarded_points integer,
  already_claimed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_claim_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NULLIF(BTRIM(p_practice_match_id), '') IS NULL THEN
    RAISE EXCEPTION 'Practice match id is required';
  END IF;

  INSERT INTO public.ai_practice_reward_claims (
    practice_match_id,
    user_id,
    points
  )
  VALUES (
    BTRIM(p_practice_match_id),
    v_user_id,
    1
  )
  ON CONFLICT (practice_match_id, user_id) DO NOTHING
  RETURNING id
  INTO v_claim_id;

  IF v_claim_id IS NOT NULL THEN

    UPDATE public.profiles p
    SET points = COALESCE(p.points, 0) + 1
    WHERE p.id = v_user_id;

    RETURN QUERY
    SELECT
      v_claim_id,
      v_user_id,
      1,
      false;

    RETURN;
  END IF;

  SELECT c.id
  INTO v_claim_id
  FROM public.ai_practice_reward_claims c
  WHERE c.practice_match_id = BTRIM(p_practice_match_id)
    AND c.user_id = v_user_id
  LIMIT 1;

  RETURN QUERY
  SELECT
    v_claim_id,
    v_user_id,
    1,
    true;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_match_reward(
  p_winner_score integer,
  p_loser_score integer
)
RETURNS TABLE(tier text, gold numeric, points integer)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    CASE
      WHEN GREATEST(0, p_winner_score - p_loser_score) <= 50 THEN 'close'
      WHEN GREATEST(0, p_winner_score - p_loser_score) <= 150 THEN 'normal'
      ELSE 'dominating'
    END AS tier,
    CASE
      WHEN GREATEST(0, p_winner_score - p_loser_score) <= 50 THEN 3::numeric
      WHEN GREATEST(0, p_winner_score - p_loser_score) <= 150 THEN 6::numeric
      ELSE 9::numeric
    END AS gold,
    CASE
      WHEN GREATEST(0, p_winner_score - p_loser_score) <= 50 THEN 10
      WHEN GREATEST(0, p_winner_score - p_loser_score) <= 150 THEN 20
      ELSE 30
    END AS points;
$$;

CREATE OR REPLACE FUNCTION public.get_leaderboard(p_limit int DEFAULT 50)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  avatar_id text,
  level integer,
  points integer,
  rank bigint,
  gold numeric
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  WITH ranked_profiles AS (
    SELECT
      p.id,
      p.username,
      p.avatar_id,
      COALESCE(p.points, 0) AS points,
      RANK() OVER (
        ORDER BY COALESCE(p.points, 0) DESC, p.created_at ASC, p.id ASC
      ) AS rank
    FROM public.profiles p
  )
  SELECT
    rp.id AS user_id,
    rp.username AS display_name,
    rp.avatar_id,
    LEAST(5, FLOOR(GREATEST(rp.points, 0) / 150)::int + 1) AS level,
    rp.points,
    rp.rank,
    COALESCE(w.gold, 0) AS gold
  FROM ranked_profiles rp
  LEFT JOIN public.wallets w ON w.user_id = rp.id
  ORDER BY rp.rank ASC, rp.points DESC, rp.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

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

-- Final least-privilege access.
REVOKE ALL ON FUNCTION public.calculate_match_reward(integer, integer)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_match_reward(integer, integer)
TO authenticated;

REVOKE ALL ON FUNCTION public.get_leaderboard(integer)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(integer)
TO authenticated, anon;

REVOKE ALL ON FUNCTION public.settle_finished_match_rewards(text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_finished_match_rewards(text, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.award_ai_practice_win(text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_ai_practice_win(text)
TO authenticated;
