# Okey production deployment

1. Apply database changes through the standard `supabase/migrations` stream with `supabase db push`; Okey objects remain isolated in the `okey` schema.
2. Deploy `okey_room`, `okey_match`, `okey_chat`, and `okey_maintenance` with JWT verification enabled. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` only as Edge Function secrets; the service key must never be in Expo variables.
3. Enable Realtime Broadcast for authenticated clients. Okey channels carry only `{ event: "invalidate", matchId, version }`; clients fetch their own projection from `okey_match` after every notification.
4. Invoke `okey_maintenance` from a protected scheduler every five seconds, passing `x-okey-worker-key: $OKEY_WORKER_SECRET`. It is the only timeout claimant. A successful authoritative command or maintenance commit hands a Bot-owned next turn to `process_bot_turns` for that exact match; do not schedule or scan `process_bot_turns` independently.
5. Fund `okey.wallets` through a privileged back-office credit flow before enabling a non-zero entry fee. `okey_charge_entry_fee` is called at game start and `okey_settle_match` exactly once after an authoritative finish; both are idempotent ledger operations.
6. Monitor Edge Function 4xx/5xx, `version_conflict`, `insufficient_entry_balance`, delayed heartbeats, and matches without `settlement_at` after `finished_at`.

Rollback is additive: disable matchmaking/deployments first, then apply a forward migration that disables the affected table. Do not delete match, command, or ledger rows in production.
