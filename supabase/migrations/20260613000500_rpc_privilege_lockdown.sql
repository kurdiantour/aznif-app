-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Explicitly
-- remove all generic balance mutation and internal sequencing entry points.

REVOKE ALL ON FUNCTION public.update_mc_balance(uuid, numeric)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_gold_balance(uuid, numeric)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.award_gold_reward(uuid, numeric, jsonb)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spend_gold_shop(uuid, numeric, jsonb)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.place_room_bet(uuid, numeric)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.next_one_vs_one_move_sequence(uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_two_vs_two_move_sequence(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_one_vs_one_move_sequence(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_two_vs_two_move_sequence(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.settle_finished_match_rewards(text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_finished_match_rewards(text, uuid)
TO service_role;

-- The obsolete three-argument transfer RPC accepted an arbitrary sender and is
-- superseded by transfer_mc_to_friend, which derives the sender from auth.uid().
REVOKE ALL ON FUNCTION public.transfer_mc(uuid, uuid, numeric)
FROM PUBLIC, anon, authenticated;

-- Trigger helpers are never valid RPC endpoints.
REVOKE ALL ON FUNCTION public.handle_new_user_wallets()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_profiles_updated_at()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_friendships_updated_at()
FROM PUBLIC, anon, authenticated;
