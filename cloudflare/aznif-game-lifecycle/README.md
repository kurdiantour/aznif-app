# Aznif shared game lifecycle

This Worker is the shared durable lifecycle alarm layer for Aznif games. Each Durable
Object is addressed by `gameType:matchId` and stores one
`{ gameType, matchId, expectedVersion, runAt }` lifecycle alarm. It owns no game state.

At alarm time it invokes exactly one authoritative transition. Supabase remains
the source of truth and rejects stale `expectedVersion` values. A committed
transition schedules a separate alarm for its next official future instant.

Okey routes to `process_bot_turns`; Dama routes to `dama_lifecycle`. Both
endpoints perform one version-bound server transition and return the next
authoritative wake. Adding Dama does not change the alarm contract, namespace,
storage record, or Durable Object identity.

## Production deployment

`wrangler.toml` contains the production Supabase URL and enables the
`workers.dev` route, minification, Durable Object migration, and observability.
The shared secret must never be committed.

Run these commands from the repository root in PowerShell:

```powershell
npx wrangler login
npx wrangler deploy --config cloudflare/aznif-game-lifecycle/wrangler.toml

$AznifLifecycleSecret = [Convert]::ToBase64String(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
$AznifLifecycleSecret | npx wrangler secret put AZNIF_LIFECYCLE_SECRET `
  --config cloudflare/aznif-game-lifecycle/wrangler.toml
```

Copy the deployed `https://aznif-game-lifecycle.<subdomain>.workers.dev` URL
printed by Wrangler, then register the same secret and Worker URL in the
production Supabase project:

```powershell
$AznifLifecycleUrl = "https://aznif-game-lifecycle.<subdomain>.workers.dev"
npx supabase secrets set --project-ref rcvrccnrzcennnbzrsex `
  "AZNIF_LIFECYCLE_SECRET=$AznifLifecycleSecret" `
  "AZNIF_GAME_LIFECYCLE_URL=$AznifLifecycleUrl"
```

Deploy the Edge Functions that consume these names:

```powershell
npx supabase functions deploy process_bot_turns --project-ref rcvrccnrzcennnbzrsex
npx supabase functions deploy okey_match --project-ref rcvrccnrzcennnbzrsex
npx supabase functions deploy okey_maintenance --project-ref rcvrccnrzcennnbzrsex
npx supabase functions deploy dama_action --project-ref rcvrccnrzcennnbzrsex
npx supabase functions deploy dama_lifecycle --project-ref rcvrccnrzcennnbzrsex
npx supabase functions deploy dama_match --project-ref rcvrccnrzcennnbzrsex
```

Do not regenerate `$AznifLifecycleSecret` between the Cloudflare and Supabase
commands. Both sides must contain the identical value.
