-- Restore authenticated access for the low-value AI practice reward.
-- The function is idempotent per (practice_match_id, user_id) and awards
-- exactly one profile point with no gold.

GRANT EXECUTE ON FUNCTION public.award_ai_practice_win(text)
TO authenticated;
