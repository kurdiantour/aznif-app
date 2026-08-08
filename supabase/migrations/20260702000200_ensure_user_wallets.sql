-- Keep wallet provisioning independent from other new-account defaults.
-- This also repairs accounts created while the auth.users trigger was absent.
CREATE OR REPLACE FUNCTION public.handle_new_user_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.wallets (user_id, mc, gold, updated_at)
  VALUES (NEW.id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_ensure_new_user_wallet ON auth.users;
CREATE TRIGGER trigger_ensure_new_user_wallet
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user_wallet();
-- Existing balances are never overwritten; only missing wallet rows are added.
INSERT INTO public.wallets (user_id, mc, gold, updated_at)
SELECT users.id, 0, 0, now()
FROM auth.users AS users
LEFT JOIN public.wallets AS wallets ON wallets.user_id = users.id
WHERE wallets.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;
-- Trigger helpers must not be callable as public RPCs.
REVOKE ALL ON FUNCTION public.handle_new_user_wallet()
FROM PUBLIC, anon, authenticated;
