-- These tables are internal implementation details. They are accessed through
-- SECURITY DEFINER functions, not directly through PostgREST/client queries.
-- Explicit deny policies keep that intent visible to Supabase Security Advisor.

CREATE POLICY "No direct client access to aznif treasury"
ON public.aznif_treasury
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY "No direct client access to aznif treasury ledger"
ON public.aznif_treasury_ledger
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY "No direct client access to private join attempts"
ON public.one_vs_one_private_join_attempts
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
