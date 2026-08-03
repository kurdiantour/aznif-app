# Okey database boundary

All Okey database migrations live in `supabase/okey/migrations`. They are
deliberately excluded from the Domino migration stream in `supabase/migrations`.

Apply them with the dedicated command documented in `scripts/apply-okey-migrations.ps1`.
The migrations create only objects in the `okey` schema and may reference the
Supabase-owned `auth.users` table. They must never modify Domino tables, RPCs,
policies, triggers, or migrations.

