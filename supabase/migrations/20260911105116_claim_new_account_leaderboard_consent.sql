CREATE TABLE public.leaderboard_consent_onboarding (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pending boolean NOT NULL DEFAULT true
);

ALTER TABLE public.leaderboard_consent_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leaderboard_consent_onboarding_select_own"
ON public.leaderboard_consent_onboarding
FOR SELECT TO authenticated
USING ((select auth.uid()) = user_id);

CREATE POLICY "leaderboard_consent_onboarding_update_own"
ON public.leaderboard_consent_onboarding
FOR UPDATE TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

REVOKE ALL ON TABLE public.leaderboard_consent_onboarding FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.leaderboard_consent_onboarding TO authenticated;
GRANT UPDATE (pending) ON TABLE public.leaderboard_consent_onboarding TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user_leaderboard_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.leaderboard_consent_onboarding (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user_leaderboard_consent()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trigger_handle_new_user_leaderboard_consent
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user_leaderboard_consent();

CREATE OR REPLACE FUNCTION public.claim_new_account_leaderboard_consent()
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.leaderboard_consent_onboarding
  SET pending = false
  WHERE user_id = auth.uid()
    AND pending = true
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_new_account_leaderboard_consent()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_new_account_leaderboard_consent()
TO authenticated;
