import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL in WASM. No network, project credentials, or remote DB.
const db = new PGlite();
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const newcomer = '33333333-3333-4333-8333-333333333333';
let multiplayerBefore;
async function asUser(id = alice) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec('SET ROLE authenticated');
}
async function admin(sql) { await db.exec('RESET ROLE'); return db.exec(sql); }
async function state() { return (await db.query('SELECT public.get_my_shop_state() AS state')).rows[0].state; }
async function purchase(id, expected = null) {
  return (await db.query('SELECT * FROM public.purchase_or_equip_shop_item($1, $2)', [id, expected])).rows[0];
}
async function count(table, condition = 'true') {
  await db.exec('RESET ROLE');
  return Number((await db.query(`SELECT count(*) AS n FROM public.${table} WHERE ${condition}`)).rows[0].n);
}
async function expectSqlError(sql, expression) {
  await db.exec('SAVEPOINT expected_error');
  await assert.rejects(db.exec(sql), expression);
  await db.exec('ROLLBACK TO SAVEPOINT expected_error');
}

before(async () => {
  // Minimal external dependencies; shop tables/functions/policies below are the
  // actual committed migrations, not a reimplementation of the shop engine.
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
    CREATE TABLE public.wallets(user_id uuid PRIMARY KEY REFERENCES auth.users(id), mc numeric NOT NULL DEFAULT 0,
      gold numeric NOT NULL DEFAULT 0 CHECK (gold >= 0), updated_at timestamptz DEFAULT now());
    CREATE TABLE public.wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
      from_user_id uuid, amount numeric NOT NULL CHECK (amount > 0), currency text, transaction_type text,
      status text, metadata jsonb, balance_before numeric, balance_after numeric);
    CREATE FUNCTION public.spend_gold_shop(uuid, numeric, jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  `);
  for (const file of [
    '20260613000300_shop_and_account_readiness',
    '20260622000100_shop_gem_purchases',
    '20260622000300_fix_purchase_or_equip_shop_item_category_ambiguity',
    '20260622000400_domino_skins_catalog_defaults',
    '20260630000400_shared_multiplayer_table',
    '20260919171900_get_multiplayer_room_cosmetics',
  ]) await db.exec(migration(file));
  await db.exec(`
    CREATE TRIGGER trigger_handle_new_user_wallets AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_wallets();
    INSERT INTO auth.users VALUES ('${alice}'), ('${bob}');
    UPDATE public.wallets SET gold = 5000;
    INSERT INTO public.user_shop_items(user_id, item_id) VALUES ('${alice}', 'skin-purple'), ('${bob}', 'table-royal');
    UPDATE public.user_equipped_shop_items SET item_id = 'skin-purple' WHERE user_id = '${alice}';
  `);
  multiplayerBefore = (await db.query(`SELECT proname, pg_get_functiondef(oid) AS body FROM pg_proc
    WHERE proname IN ('get_multiplayer_room_table', 'get_multiplayer_room_cosmetics') ORDER BY proname`)).rows;
  await db.exec(migration('20260919193000_add_domino_sets'));
});
after(async () => db.close());
beforeEach(async () => { await db.exec('RESET ROLE; BEGIN'); });
afterEach(async () => { await db.exec('ROLLBACK; RESET ROLE'); });

test('migration preserves paid legacy ownership/equip and remaps only the free legacy default', async () => {
  await asUser();
  const data = await state();
  assert.equal(data.equipped['domino-skins'], 'skin-purple');
  assert.equal(data.items.find((i) => i.id === 'skin-purple').owned, true);
  assert.equal(data.items.find((i) => i.id === 'skin-purple').active, false);
  assert.equal(data.items.find((i) => i.id === 'skin-purple').access_kind, 'owned');
  await asUser(bob);
  assert.equal((await state()).equipped['domino-skins'], 'domino-classic');
  assert.equal(await count('user_shop_items', "item_id = 'skin-ivory'"), 2);
});

test('existing and new users get all metadata defaults; missing equip resolves without hardcoded IDs', async () => {
  await admin(`INSERT INTO auth.users VALUES ('${newcomer}')`);
  await asUser(newcomer);
  let data = await state();
  for (const item of data.items.filter((i) => i.is_default)) {
    assert.equal(item.price_gold, 0); assert.equal(item.owned, true);
    assert.equal(data.equipped[item.category], item.id);
  }
  await admin(`DELETE FROM public.user_equipped_shop_items WHERE user_id = '${newcomer}'`);
  await asUser(newcomer);
  data = await state();
  for (const item of data.items.filter((i) => i.is_default)) assert.equal(data.equipped[item.category], item.id);
});

test('default metadata cannot be priced, hidden, disabled, moved, removed, duplicated or scheduled', async () => {
  for (const assignment of ["price_gold = 3", "price_gold = NULL", "active = false", "enabled = false",
    "is_default = false", "category = 'domino-skins'", "available_until = now() + interval '1 day'"]) {
    await expectSqlError(`UPDATE public.shop_items SET ${assignment} WHERE id = 'table-classic'`, /default|constraint/i);
  }
  await expectSqlError("DELETE FROM public.shop_items WHERE id = 'table-classic'", /default/);
  await expectSqlError("UPDATE public.shop_items SET is_default = true, price_gold = 0 WHERE id = 'table-midnight'", /unique/);
});

test('Zagros is unpriced and cannot be activated or acquired until configured', async () => {
  await expectSqlError("UPDATE public.shop_items SET active = true WHERE id = 'table-zagros'", /priced_before_sale/);
  await asUser();
  const zagros = (await state()).items.find((i) => i.id === 'table-zagros');
  assert.equal(zagros.price_gold, null); assert.equal(zagros.active, false);
  assert.equal((await purchase(zagros.id)).status, 'unavailable');
  assert.equal(await count('user_shop_items', "item_id = 'table-zagros'"), 0);
});

test('paid acquisition is atomic and repeat/queued requests charge once', async () => {
  await asUser();
  const results = await Promise.all([purchase('table-midnight', 350), purchase('table-midnight', 350)]);
  assert.deepEqual(results.map((r) => r.status), ['purchased', 'equipped']);
  assert.equal(Number(results[1].balance_after), 4650);
  assert.equal((await state()).equipped.tables, 'table-midnight');
  assert.equal(await count('wallet_transactions', "metadata->>'item_id' = 'table-midnight'"), 1);
  assert.equal(await count('user_shop_items', "item_id = 'table-midnight'"), 1);
});

test('insufficient balance, missing consent and stale price cannot charge', async () => {
  await asUser();
  assert.equal((await purchase('table-midnight')).status, 'price_changed');
  assert.equal((await purchase('table-midnight', 1)).status, 'price_changed');
  await admin(`UPDATE public.wallets SET gold = 1 WHERE user_id = '${alice}'`);
  await asUser();
  assert.equal((await purchase('table-midnight', 350)).status, 'insufficient_gems');
  assert.equal(await count('wallet_transactions'), 0);
});

test('hidden and out-of-sale-window purchases stay usable by owners; explicit disable is separate', async () => {
  await asUser(); await purchase('table-midnight', 350);
  await admin("UPDATE public.shop_items SET active = false, available_until = now() - interval '1 hour' WHERE id = 'table-midnight'");
  await asUser();
  assert.equal((await purchase('table-midnight')).status, 'equipped');
  assert.equal((await state()).equipped.tables, 'table-midnight');
  await asUser(bob);
  assert.equal((await purchase('table-midnight', 350)).status, 'unavailable');
  await admin("UPDATE public.shop_items SET enabled = false WHERE id = 'table-midnight'");
  await asUser();
  assert.equal((await state()).equipped.tables, 'table-classic');
  assert.equal((await state()).items.find((i) => i.id === 'table-midnight').owned, true);
});

test('promotion requires both valid finite endpoints; null endpoints do not accidentally grant free use', async () => {
  for (const assignment of ["free_from = now()", "free_until = now()", "free_from = now(), free_until = now()",
    "free_from = now(), free_until = now() - interval '1 day'", "free_from = '-infinity', free_until = 'infinity'"]) {
    await expectSqlError(`UPDATE public.shop_items SET ${assignment} WHERE id = 'table-midnight'`, /promotion_window/);
  }
  await asUser();
  assert.equal((await state()).items.find((i) => i.id === 'table-midnight').access_kind, null);
  assert.equal((await purchase('table-midnight')).status, 'price_changed');
});

test('temporary free equips without ownership or charge; expiration falls back only for nonowners', async () => {
  await admin("UPDATE public.shop_items SET free_from = now() - interval '1 hour', free_until = now() + interval '1 hour' WHERE id = 'table-royal'");
  await asUser();
  assert.equal((await purchase('table-royal')).status, 'equipped');
  assert.equal((await state()).items.find((i) => i.id === 'table-royal').access_kind, 'temporary');
  assert.equal(await count('user_shop_items', `user_id = '${alice}' AND item_id = 'table-royal'`), 0);
  await asUser(bob); await purchase('table-royal');
  await admin("UPDATE public.shop_items SET free_until = now() - interval '1 second' WHERE id = 'table-royal'");
  await asUser();
  assert.equal((await state()).equipped.tables, 'table-classic');
  assert.equal((await purchase('table-royal')).status, 'price_changed');
  await asUser(bob); assert.equal((await state()).equipped.tables, 'table-royal');
  assert.equal(await count('wallet_transactions'), 0);
});

test('exact promotion start is inclusive and end exclusive, including zero base price', async () => {
  await admin("UPDATE public.shop_items SET free_from = '2026-01-01', free_until = '2026-02-01' WHERE id = 'table-midnight'");
  const at = async (time) => (await db.query("SELECT shop_private.access_kind(s, false, $1::timestamptz) AS access FROM public.shop_items s WHERE s.id = 'table-midnight'", [time])).rows[0].access;
  assert.equal(await at('2025-12-31'), null);
  assert.equal(await at('2026-01-01'), 'temporary');
  assert.equal(await at('2026-02-01'), null);
  await admin("UPDATE public.shop_items SET price_gold = 0, free_from = now() - interval '1 hour', free_until = now() + interval '1 hour' WHERE id = 'table-midnight'");
  await asUser(); await purchase('table-midnight');
  assert.equal(await count('user_shop_items', "item_id = 'table-midnight'"), 0);
});

test('an arbitrary sixth set works by adding one row, with an unrelated asset key', async () => {
  await admin("INSERT INTO public.shop_items(id,title,description,category,price_gold,asset_key) VALUES ('sixth-test-product','Fixture','Only in rolled back test','tables',77,'independent-bundle-key')");
  await asUser();
  assert.equal((await purchase('sixth-test-product', 77)).status, 'purchased');
  const data = await state();
  assert.equal(data.equipped.tables, 'sixth-test-product');
  assert.equal(data.items.find((i) => i.id === 'sixth-test-product').asset_key, 'independent-bundle-key');
});

test('catalog sort and price come from the database', async () => {
  await admin("UPDATE public.shop_items SET price_gold = 123, sort_order = -20 WHERE id = 'table-midnight'");
  await asUser();
  assert.equal((await state()).items[0].id, 'table-midnight');
  assert.equal((await purchase('table-midnight', 350)).status, 'price_changed');
  assert.equal(Number((await purchase('table-midnight', 123)).balance_after), 4877);
});

test('a ledger failure rolls back debit, ownership and equipment together', async () => {
  await admin(`CREATE FUNCTION public.reject_test_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test ledger failure'; END $$;
    CREATE TRIGGER reject_test_ledger BEFORE INSERT ON public.wallet_transactions FOR EACH ROW EXECUTE FUNCTION public.reject_test_ledger();`);
  await asUser();
  await expectSqlError("SELECT * FROM public.purchase_or_equip_shop_item('table-midnight', 350)", /test ledger failure/);
  assert.equal((await state()).equipped.tables, 'table-classic');
  assert.equal(await count('user_shop_items', "item_id = 'table-midnight'"), 0);
  assert.equal(Number((await db.query(`SELECT gold FROM public.wallets WHERE user_id = '${alice}'`)).rows[0].gold), 5000);
});

test('RLS and RPC privileges isolate users and prohibit direct client mutations', async () => {
  await asUser();
  assert.equal((await db.query('SELECT * FROM public.user_shop_items')).rows.some((r) => r.user_id === bob), false);
  assert.equal((await state()).items.find((i) => i.id === 'table-royal').owned, false);
  await expectSqlError("INSERT INTO public.user_shop_items(user_id,item_id) VALUES (auth.uid(),'table-midnight')", /permission|policy/i);
  await expectSqlError("UPDATE public.shop_items SET price_gold = 0 WHERE id = 'table-midnight'", /permission/i);
  await expectSqlError("SELECT * FROM public.purchase_shop_item('table-midnight')", /permission/i);
  await expectSqlError('SELECT shop_private.protect_default()', /permission/i);
  await db.exec('RESET ROLE; SET ROLE anon');
  await expectSqlError('SELECT public.get_my_shop_state()', /permission/i);
  await expectSqlError("SELECT public.purchase_or_equip_shop_item('table-midnight',350)", /permission/i);
});

test('unauthenticated calls fail, and equipment cannot cross categories', async () => {
  await asUser('');
  await expectSqlError('SELECT public.get_my_shop_state()', /Authentication required/);
  await expectSqlError("SELECT public.purchase_or_equip_shop_item('table-classic')", /Authentication required/);
  await admin('SELECT 1');
  await expectSqlError(`UPDATE public.user_equipped_shop_items SET item_id = 'table-classic' WHERE user_id = '${alice}' AND category = 'domino-skins'`, /foreign key/);
});

test('multiplayer function definitions remain byte-for-byte unchanged in PostgreSQL', async () => {
  const after = (await db.query(`SELECT proname, pg_get_functiondef(oid) AS body FROM pg_proc
    WHERE proname IN ('get_multiplayer_room_table', 'get_multiplayer_room_cosmetics') ORDER BY proname`)).rows;
  assert.deepEqual(after, multiplayerBefore);
});

test('documents the pre-existing Emerald migration price_gem / price_gold history mismatch', async () => {
  await expectSqlError(migration('20260914133715_add_emerald_ivory_shop_item'), /price_gem/);
});
