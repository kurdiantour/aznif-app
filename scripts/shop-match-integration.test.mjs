import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Real game tables and matchmaking RPCs; full-history blockers have a separate audit command.
test('real matchmaking RPCs lock Okey and Domino rosters before gameplay', async () => {
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
    const files = readdirSync(directory).filter(name => name.endsWith('.sql') && name < '20260813000300').sort();
    // Real prerequisite chain, followed by current membership/start RPCs and all five canonical files.
    // This is intentionally NOT a claim that the full historical chain is replayable.
    files.push('20260813000400_okey_membership_release.sql',
      '20260821123000_fix_one_vs_one_legal_finish_settlement.sql',
      ...readdirSync(directory).filter(name => name.startsWith('20260921000')).sort());
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

    const users = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
    for (const id of users) await db.query('INSERT INTO auth.users(id,email) VALUES ($1,$2)', [id, `${id}@example.test`]);
    await db.exec('UPDATE public.wallets SET gem=5000,coin=100000,mc=100000');
    const asUser = async (id) => {
      await db.exec('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[id]);
      await db.exec('SET ROLE authenticated');
    };
    for (const mode of ['1v1','2v2']) {
      await db.exec('RESET ROLE; BEGIN');
      await asUser(users[0]);
      await db.query("SELECT * FROM public.purchase_or_equip_shop_item('domino-emerald-ivory',430)");
      let matched;
      for (const id of users.slice(0, mode === '1v1' ? 2 : 4)) {
        await asUser(id);
        matched = (await db.query('SELECT public.find_domino_match($1,$2,$3) AS result',[mode,'fun',mode === '1v1' ? 500 : 3500])).rows[0].result;
      }
      assert.equal(matched.status,'matched');
      const resolve = async () => (await db.query('SELECT public.resolve_domino_room_cosmetics($1,$2) AS result',[matched.room_id,mode])).rows[0].result;
      const snapshot = await resolve();
      assert.equal(snapshot.locked,true); assert.equal(snapshot.shared_set_asset_key,'domino-emerald-ivory');
      assert.equal(Object.keys(snapshot.player_set_asset_keys).length,mode === '1v1' ? 2 : 4);
      await asUser(users[0]);
      await db.query("SELECT * FROM public.purchase_or_equip_shop_item('domino-classic',0)");
      await db.query(`SELECT public.${mode === '1v1' ? 'start_one_vs_one_game' : 'start_two_vs_two_game'}($1)`,[matched.room_id]);
      assert.deepEqual(await resolve(),snapshot);
      await db.exec('ROLLBACK; RESET ROLE');
    }
    await db.exec('RESET ROLE; BEGIN');
    await asUser(users[0]);
    await db.query("SELECT * FROM public.purchase_or_equip_shop_item('domino-emerald-ivory',430)");
    const privateRoom = (await db.query('SELECT * FROM public.create_private_10_aznif_room()')).rows[0];
    await asUser(users[1]);
    const joined = (await db.query('SELECT public.join_private_10_aznif_room($1) AS result',[privateRoom.room_code])).rows[0].result;
    assert.equal(joined.ok,true);
    const privateSnapshot = (await db.query("SELECT public.resolve_domino_room_cosmetics($1,'1v1') AS result",[privateRoom.id])).rows[0].result;
    assert.equal(privateSnapshot.locked,true);
    assert.equal(privateSnapshot.shared_set_asset_key,'domino-emerald-ivory');
    await db.exec('ROLLBACK; RESET ROLE');
    await asUser(users[0]);
    await db.query("SELECT * FROM public.purchase_or_equip_shop_item('table-royal',520)");
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
    await db.exec('SET ROLE service_role');
    let room;
    for (const id of users) room = (await db.query("SELECT public.okey_room_action($1,'matchmake',null,'classic') AS result",[id])).rows[0].result;
    assert.ok(room.countdownEndsAt);
    const locked = (await db.query('SELECT public.resolve_okey_match_cosmetics($1) AS result',[room.matchId ?? room.id])).rows[0].result;
    assert.equal(locked.locked,true); assert.equal(locked.shared_set_asset_key,'table-royal');
    assert.equal(Object.keys(locked.player_set_asset_keys).length,4);
  } finally { await db.close(); }
});
