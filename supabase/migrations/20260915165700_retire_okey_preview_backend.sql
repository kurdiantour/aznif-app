-- Retire Okey Preview/Test Match database entry points. Historical migrations remain intact.
drop function if exists public.okey_preview_test_join_or_create(uuid, uuid[]);
drop function if exists public.okey_preview_test_start(uuid, uuid, jsonb, jsonb, timestamptz);
drop function if exists public.okey_create_preview_test_match(uuid, uuid, uuid[], jsonb, jsonb, timestamptz);
drop function if exists public.okey_create_preview_test_match(uuid, uuid[], jsonb, jsonb, timestamptz);
drop function if exists public.okey_settle_test_match(uuid, text);
drop trigger if exists reject_test_match_wallet_ledger on okey.wallet_ledger;
drop function if exists okey.reject_test_match_wallet_ledger();
drop table if exists okey.test_bot_accounts;

