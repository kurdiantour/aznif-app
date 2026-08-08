-- Production leaderboard and match reward settlement.
-- Rewards are derived from finished real match rooms only; clients never provide
-- leaderboard points or gold amounts.

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
GRANT SELECT ON public.match_reward_records TO authenticated;
-- Restrict direct profile edits to display fields. Leaderboard fields are
-- updated only by SECURITY DEFINER reward functions.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (username, avatar_id) ON public.profiles TO authenticated;
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
      p.level,
      p.points,
      RANK() OVER (ORDER BY p.points DESC, p.created_at ASC, p.id ASC) AS rank
    FROM public.profiles p
  )
  SELECT
    rp.id AS user_id,
    rp.username AS display_name,
    rp.avatar_id,
    rp.level,
    rp.points,
    rp.rank,
    COALESCE(w.gold, 0) AS gold
  FROM ranked_profiles rp
  LEFT JOIN public.wallets w ON w.user_id = rp.id
  ORDER BY rp.rank ASC, rp.points DESC, rp.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;
CREATE OR REPLACE FUNCTION public.settle_match_rewards(
  p_mode text,
  p_room_id uuid
)
RETURNS TABLE(
  reward_id uuid,
  user_id uuid,
  points integer,
  gold numeric,
  already_claimed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
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
  v_existing uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_mode NOT IN ('1v1', '2v2') THEN
    RAISE EXCEPTION 'Invalid match mode: %', p_mode;
  END IF;

  IF p_mode = '1v1' THEN
    SELECT status, state
    INTO v_status, v_state
    FROM public.one_vs_one_rooms
    WHERE id = p_room_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '1v1 room not found';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.one_vs_one_players
      WHERE room_id = p_room_id
        AND user_id = v_caller
    ) THEN
      RAISE EXCEPTION 'You are not a player in this 1v1 room';
    END IF;
  ELSE
    SELECT status, state
    INTO v_status, v_state
    FROM public.two_vs_two_rooms
    WHERE id = p_room_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '2v2 room not found';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.two_vs_two_players
      WHERE room_id = p_room_id
        AND user_id = v_caller
    ) THEN
      RAISE EXCEPTION 'You are not a player in this 2v2 room';
    END IF;
  END IF;

  IF v_status <> 'finished' THEN
    RAISE EXCEPTION 'Match is not finished';
  END IF;

  v_winning_team := v_state ->> 'winningTeamId';

  IF v_winning_team NOT IN ('teamA', 'teamB') THEN
    RAISE EXCEPTION 'Finished match has no winning team';
  END IF;

  IF p_mode = '1v1' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.one_vs_one_players
      WHERE room_id = p_room_id
        AND user_id = v_caller
        AND team_id = v_winning_team
    ) THEN
      RAISE EXCEPTION 'Only a winning player can settle match rewards';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.two_vs_two_players
      WHERE room_id = p_room_id
        AND user_id = v_caller
        AND team_id = v_winning_team
    ) THEN
      RAISE EXCEPTION 'Only a winning player can settle match rewards';
    END IF;
  END IF;

  v_team_scores := COALESCE(v_state -> 'teamScores', '{}'::jsonb);
  v_winner_score := COALESCE((v_team_scores ->> v_winning_team)::int, 0);
  v_loser_score := COALESCE((v_team_scores ->> CASE WHEN v_winning_team = 'teamA' THEN 'teamB' ELSE 'teamA' END)::int, 0);

  IF v_state ? 'matchReward' AND jsonb_typeof(v_state -> 'matchReward') = 'object' THEN
    v_tier := COALESCE(v_state #>> '{matchReward,tier}', 'normal');
    v_gold := COALESCE((v_state #>> '{matchReward,gold}')::numeric, 0);
    v_points := COALESCE((v_state #>> '{matchReward,points}')::int, 0);
  ELSE
    SELECT tier, gold, points
    INTO v_tier, v_gold, v_points
    FROM public.calculate_match_reward(v_winner_score, v_loser_score);
  END IF;

  IF v_points < 0 OR v_gold < 0 THEN
    RAISE EXCEPTION 'Invalid match reward values';
  END IF;

  FOR v_player IN
    EXECUTE format(
      'SELECT user_id, team_id FROM public.%I WHERE room_id = $1 AND team_id = $2 AND user_id IS NOT NULL ORDER BY player_index',
      CASE WHEN p_mode = '1v1' THEN 'one_vs_one_players' ELSE 'two_vs_two_players' END
    )
    USING p_room_id, v_winning_team
  LOOP
    v_existing := NULL;
    v_reward_id := NULL;

    SELECT id
    INTO v_existing
    FROM public.match_reward_records
    WHERE room_id = p_room_id
      AND mode = p_mode
      AND user_id = v_player.user_id;

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
        'settled_by', v_caller
      )
    )
    ON CONFLICT (room_id, mode, user_id) DO NOTHING
    RETURNING id INTO v_reward_id;

    IF v_reward_id IS NOT NULL THEN
      UPDATE public.profiles
      SET points = public.profiles.points + v_points
      WHERE id = v_player.user_id;

      IF v_gold > 0 THEN
        INSERT INTO public.wallets(user_id, mc, gold, updated_at)
        VALUES (v_player.user_id, 0, 0, now())
        ON CONFLICT (user_id) DO NOTHING;

        SELECT gold
        INTO v_before_gold
        FROM public.wallets
        WHERE user_id = v_player.user_id
        FOR UPDATE;

        v_after_gold := COALESCE(v_before_gold, 0) + v_gold;

        UPDATE public.wallets
        SET gold = v_after_gold,
            updated_at = now()
        WHERE user_id = v_player.user_id;

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

      reward_id := v_reward_id;
      user_id := v_player.user_id;
      points := v_points;
      gold := v_gold;
      already_claimed := false;
      RETURN NEXT;
    ELSE
      reward_id := v_existing;
      user_id := v_player.user_id;
      points := v_points;
      gold := v_gold;
      already_claimed := true;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(int) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.settle_match_rewards(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_match_reward(integer, integer) TO authenticated;
