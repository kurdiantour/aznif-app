-- Lightweight MVP protection for local AI Practice rewards.
-- This deliberately keeps gameplay local and does not impose a daily cap or
-- cooldown. It prevents malformed IDs, duplicate claims, and concurrent claim
-- bursts for the same authenticated user.

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
  v_match_id text := lower(BTRIM(COALESCE(p_practice_match_id, '')));
  v_claim_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- The app creates RFC 4122 version-4 UUIDs. Exact validation also bounds
  -- storage and prevents arbitrary strings from becoming idempotency keys.
  IF char_length(v_match_id) <> 36 OR v_match_id !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'Invalid AI practice match id';
  END IF;

  -- Reject overlapping requests instead of queueing a burst. This is a soft
  -- anti-spam guard only; it intentionally does not limit sequential wins.
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended(v_user_id::text, 21)
  ) THEN
    RAISE EXCEPTION 'AI practice reward request already in progress';
  END IF;

  INSERT INTO public.ai_practice_reward_claims(
    practice_match_id,
    user_id,
    points
  ) VALUES (
    v_match_id,
    v_user_id,
    1
  )
  ON CONFLICT (practice_match_id, user_id) DO NOTHING
  RETURNING id INTO v_claim_id;

  IF v_claim_id IS NOT NULL THEN
    UPDATE public.profiles
    SET points = COALESCE(points, 0) + 1
    WHERE id = v_user_id;

    RETURN QUERY SELECT v_claim_id, v_user_id, 1, false;
    RETURN;
  END IF;

  SELECT claim.id INTO v_claim_id
  FROM public.ai_practice_reward_claims AS claim
  WHERE claim.practice_match_id = v_match_id
    AND claim.user_id = v_user_id;

  RETURN QUERY SELECT v_claim_id, v_user_id, 1, true;
END;
$$;

REVOKE ALL ON FUNCTION public.award_ai_practice_win(text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_ai_practice_win(text)
TO authenticated;
