import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');

test('signup: real Profile/Wallet triggers plus canonical Shop work as Auth admin', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE ROLE supabase_auth_admin; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA auth, public TO supabase_auth_admin, authenticated;
      GRANT INSERT ON auth.users TO supabase_auth_admin;`);
    for (const file of ['20260524000100_create_profiles', '20260524000200_wallets_mc', '20260702000200_ensure_user_wallets']) await db.exec(migration(file));
    // Commerce prerequisite added by the later economy migration; no trigger substitutes.
    await db.exec('ALTER TABLE public.wallets ADD COLUMN coin numeric NOT NULL DEFAULT 0, ADD COLUMN gem numeric NOT NULL DEFAULT 0;');
    await db.exec('SET ROLE supabase_auth_admin');
    await assert.rejects(db.exec("INSERT INTO auth.users VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','before@example.test')"), /permission denied/);
    await db.exec('RESET ROLE');
    for (const file of ['20260921000100_shop_catalog', '20260921000200_shop_commerce']) await db.exec(migration(file));
    await db.exec(`SET ROLE supabase_auth_admin;
      INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111','after@example.test');
      RESET ROLE;`);
    const wallet = (await db.query('SELECT mc,coin,gem FROM public.wallets')).rows;
    assert.equal(wallet.length, 1);
    for (const balance of Object.values(wallet[0])) assert.equal(Number(balance), 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.profiles')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.user_shop_items')).rows[0].n, 2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.user_equipped_shop_items')).rows[0].n, 2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trigger_handle_new_user_wallets'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT prosecdef FROM pg_proc WHERE proname='handle_new_user_wallet'")).rows[0].prosecdef, true);
  } finally { await db.close(); }
});
