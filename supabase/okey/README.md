# Okey database boundary

Okey database migrations live in `supabase/migrations` and participate in the standard Supabase migration stream. Okey SQL objects remain isolated in the `okey` schema and may reference the Supabase-owned `auth.users` table.
