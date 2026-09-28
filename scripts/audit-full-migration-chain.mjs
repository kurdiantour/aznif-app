import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Emulates Supabase platform roles/auth only. Application migrations are executed unmodified.
test('fresh install: entire migration chain and signup under Auth role', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE ROLE supabase_auth_admin;
      CREATE ROLE authenticator;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}', raw_app_meta_data jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, supabase_auth_admin;
      GRANT INSERT, SELECT ON auth.users TO supabase_auth_admin;
      CREATE PUBLICATION supabase_realtime;
    `);
    const directory = new URL('../supabase/migrations/', import.meta.url);
    const files = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
    for (const file of files) {
      // Historical treasury conversion requires one pre-existing official admin.
      // This is an explicit data prerequisite, not a skipped/rewritten migration.
      if (file === '20260713000900_wallet_backed_aznif_treasury.sql') {
        await db.exec(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','treasury@example.test','{"username":"treasury_fixture"}');
          UPDATE public.profiles SET is_admin=true WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';`);
      }
      try { await db.exec(readFileSync(new URL(file, directory), 'utf8')); }
      catch (error) { throw new Error(`Migration ${file}: ${error.message}`); }
    }
    await db.exec(`SET ROLE supabase_auth_admin;
      INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('11111111-1111-4111-8111-111111111111','fresh@example.test','{"username":"fresh_core"}');
      RESET ROLE;`);
    for (const table of ['profiles', 'wallets']) {
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${table === 'profiles' ? 'id' : 'user_id'} = '11111111-1111-4111-8111-111111111111'`)).rows[0].n, 1);
    }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.user_shop_items WHERE user_id=\'11111111-1111-4111-8111-111111111111\'')).rows[0].n, 2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.user_equipped_shop_items WHERE user_id=\'11111111-1111-4111-8111-111111111111\'')).rows[0].n, 2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trigger_handle_new_user_wallets'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.multiplayer_match_stat_results'::regclass")).rows[0].relrowsecurity, true);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('record_one_vs_one_match_stats','record_two_vs_two_match_stats')")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('capture_one_vs_one_final_match_stats','capture_two_vs_two_final_match_stats') AND tgdeferrable AND tginitdeferred")).rows[0].n, 2);
    assert.equal((await db.query("SELECT has_function_privilege('authenticated','multiplayer_private.record_player_results(text,uuid,bigint,text,jsonb)','EXECUTE') AS allowed")).rows[0].allowed,false);
    console.log(`Executed ${files.length} application migrations without rewriting or skipping SQL.`);
  } finally { await db.close(); }
});
