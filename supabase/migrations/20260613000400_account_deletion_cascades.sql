-- Ensure auth account deletion cannot be blocked by historical audit rows.
ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_user_id_fkey,
  DROP CONSTRAINT IF EXISTS wallet_transactions_from_user_id_fkey,
  DROP CONSTRAINT IF EXISTS wallet_transactions_to_user_id_fkey;
ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT wallet_transactions_from_user_id_fkey
    FOREIGN KEY (from_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT wallet_transactions_to_user_id_fkey
    FOREIGN KEY (to_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.one_vs_one_moves
  DROP CONSTRAINT IF EXISTS one_vs_one_moves_player_id_fkey;
ALTER TABLE public.one_vs_one_moves
  ADD CONSTRAINT one_vs_one_moves_player_id_fkey
    FOREIGN KEY (player_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.two_vs_two_moves
  DROP CONSTRAINT IF EXISTS two_vs_two_moves_player_id_fkey;
ALTER TABLE public.two_vs_two_moves
  ADD CONSTRAINT two_vs_two_moves_player_id_fkey
    FOREIGN KEY (player_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.one_vs_one_rooms ALTER COLUMN host_user_id DROP NOT NULL;
ALTER TABLE public.one_vs_one_rooms DROP CONSTRAINT IF EXISTS one_vs_one_rooms_host_user_id_fkey;
ALTER TABLE public.one_vs_one_rooms ADD CONSTRAINT one_vs_one_rooms_host_user_id_fkey
  FOREIGN KEY (host_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.two_vs_two_rooms ALTER COLUMN host_user_id DROP NOT NULL;
ALTER TABLE public.two_vs_two_rooms DROP CONSTRAINT IF EXISTS two_vs_two_rooms_host_user_id_fkey;
ALTER TABLE public.two_vs_two_rooms ADD CONSTRAINT two_vs_two_rooms_host_user_id_fkey
  FOREIGN KEY (host_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
