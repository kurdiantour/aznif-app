-- AI Practice Rewards
-- One AI win = exactly 1 leaderboard point.
-- Idempotent per (practice_match_id, user_id).

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
GRANT EXECUTE ON FUNCTION public.award_ai_practice_win(text)
TO authenticated;
