# Aznif

Aznif is an Expo/React Native domino game backed by Supabase Postgres, Realtime,
and Edge Functions.

## Local validation

```bash
npm ci
npm run check
```

CI additionally runs `deno check` for every Supabase Edge Function entry point.

Create `.env.local` with `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY`. Never expose `SUPABASE_SERVICE_ROLE_KEY` in an
Expo environment variable.

## Supabase deployment

Apply migrations in timestamp order, then deploy all functions:

```bash
npx supabase db push
npx supabase functions deploy submit_one_vs_one
npx supabase functions deploy submit_two_vs_two
npx supabase functions deploy process_bot_turns
npx supabase functions deploy delete_account
```

Set `SUPABASE_SERVICE_ROLE_KEY` and a random `BOT_WORKER_SECRET` as Edge Function
secrets. Schedule `process_bot_turns` from trusted infrastructure using the
`x-bot-worker-secret` header; clients may invoke it only as authenticated room
members.

Configure Supabase Auth email templates and allow the native redirect URL
`dominoapp://auth-callback` (plus the production web callback, if web is shipped).

## Release gates

- `npm run check` passes.
- All migrations are applied to staging before production.
- Migration `20260613000500_rpc_privilege_lockdown.sql` is applied before any
  economy-enabled client is released.
- Edge Functions are deployed after `commit_multiplayer_action` exists.
- Android and iOS release builds are tested on physical devices.
- Production auth redirect URLs, backups, monitoring, privacy policy, and store
  metadata are configured outside this repository.
