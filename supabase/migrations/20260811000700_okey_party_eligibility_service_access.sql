-- okey_room performs server-side eligibility checks for both party members.
-- RLS bypass alone does not replace table privileges, so grant the Edge
-- Function's service role only the read access required by those checks.

GRANT SELECT ON TABLE public.user_presence TO service_role;
GRANT SELECT ON TABLE public.wallets TO service_role;
GRANT SELECT ON TABLE public.profiles TO service_role;

NOTIFY pgrst, 'reload schema';

