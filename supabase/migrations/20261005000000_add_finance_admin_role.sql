-- Finance Admin role only.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_finance_admin boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_finance_admin_not_owner
  CHECK (NOT (is_admin AND is_finance_admin));

-- The app's profile UPDATE grants are column-specific; do not grant this role column.
REVOKE UPDATE (is_finance_admin) ON public.profiles FROM authenticated, anon, PUBLIC;

CREATE OR REPLACE FUNCTION public.current_user_is_finance_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_finance_admin = true
      AND p.is_admin = false
  );
$$;
REVOKE ALL ON FUNCTION public.current_user_is_finance_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_finance_admin() TO authenticated;

NOTIFY pgrst, 'reload schema';
