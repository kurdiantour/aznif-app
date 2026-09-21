import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, afterEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';

async function asUser(id = alice) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.query("SELECT set_config('request.jwt.claim.role', 'authenticated', false)");
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

before(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT current_setting('request.jwt.claim.role', true)
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    CREATE SCHEMA okey;
    CREATE TABLE okey.matches(id uuid PRIMARY KEY, status text NOT NULL, countdown_deadline_at timestamptz);
    CREATE TABLE okey.match_seats(match_id uuid REFERENCES okey.matches(id), user_id uuid REFERENCES auth.users(id), membership_released_at timestamptz);
    CREATE TABLE public.one_vs_one_rooms(id uuid PRIMARY KEY, status text NOT NULL);
    CREATE TABLE public.two_vs_two_rooms(id uuid PRIMARY KEY, status text NOT NULL);
    CREATE TABLE public.one_vs_one_players(room_id uuid REFERENCES public.one_vs_one_rooms(id), user_id uuid REFERENCES auth.users(id), left_at timestamptz);
    CREATE TABLE public.two_vs_two_players(room_id uuid REFERENCES public.two_vs_two_rooms(id), user_id uuid REFERENCES auth.users(id), left_at timestamptz);
    CREATE TABLE public.wallets(
      user_id uuid PRIMARY KEY REFERENCES auth.users(id),
      mc numeric NOT NULL DEFAULT 0, coin numeric NOT NULL DEFAULT 0,
      gem numeric NOT NULL DEFAULT 0 CHECK (gem >= 0), updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.wallet_transactions(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, from_user_id uuid,
      amount numeric NOT NULL CHECK (amount > 0), currency text, transaction_type text,
      status text, metadata jsonb, balance_before numeric, balance_after numeric
    );
  `);
  for (const file of [
    '20260921000100_shop_catalog',
    '20260921000200_shop_commerce',
    '20260921000300_multiplayer_cosmetics_foundation',
    '20260921000400_okey_multiplayer_cosmetics',
    '20260921000500_domino_multiplayer_cosmetics',
  ]) await db.exec(migration(file));
  await db.exec(`
    INSERT INTO auth.users VALUES ('${alice}'), ('${bob}');
    INSERT INTO public.wallets(user_id, mc, coin, gem, updated_at)
    VALUES ('${alice}', 0, 0, 5000, now()), ('${bob}', 0, 0, 5000, now())
    ON CONFLICT (user_id) DO UPDATE SET gem = EXCLUDED.gem, updated_at = EXCLUDED.updated_at;
  `);
});
after(async () => db.close());
beforeEach(async () => { await db.exec('RESET ROLE; BEGIN'); });
afterEach(async () => { await db.exec('ROLLBACK; RESET ROLE'); });

test('catalog is canonical Gem-only data and current sets/prices come from DB', async () => {
  const columns = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='shop_items'`)).rows.map(r => r.column_name);
  assert.ok(columns.includes('price_gem'));
  assert.ok(!columns.includes('price_gold'));
  const rows = (await db.query(`SELECT id, price_gem FROM public.shop_items ORDER BY sort_order,id`)).rows;
  assert.equal(Number(rows.find(r => r.id === 'table-zagros').price_gem), 1200);
  assert.equal(Number(rows.find(r => r.id === 'domino-emerald-ivory').price_gem), 430);
});

test('new users receive and equip both database defaults', async () => {
  await asUser();
  const data = await state();
  assert.equal(data.equipped.tables, 'table-classic');
  assert.equal(data.equipped['domino-skins'], 'domino-classic');
});

test('paid purchase uses locked DB price, Gem, ownership and equip atomically', async () => {
  await asUser();
  assert.equal((await purchase('table-midnight', 1)).status, 'price_changed');
  const result = await purchase('table-midnight', 350);
  assert.equal(result.status, 'purchased');
  assert.equal(Number(result.balance_after), 4650);
  assert.equal((await state()).equipped.tables, 'table-midnight');
  assert.equal(await count('wallet_transactions', "currency='Gem' AND metadata->>'item_id'='table-midnight'"), 1);
  assert.equal(await count('user_shop_items', `user_id='${alice}' AND item_id='table-midnight'`), 1);
});

test('repeat equip does not charge twice', async () => {
  await asUser();
  await purchase('table-royal', 520);
  const again = await purchase('table-royal');
  assert.equal(again.status, 'equipped');
  assert.equal(await count('wallet_transactions', "metadata->>'item_id'='table-royal'"), 1);
});

test('temporary free grants use without permanent ownership and expires to default', async () => {
  await admin("UPDATE public.shop_items SET free_from=now()-interval '1 hour', free_until=now()+interval '1 hour' WHERE id='table-royal'");
  await asUser();
  assert.equal((await purchase('table-royal')).status, 'equipped');
  assert.equal(await count('user_shop_items', `user_id='${alice}' AND item_id='table-royal'`), 0);
  await admin("UPDATE public.shop_items SET free_until=now()-interval '1 second' WHERE id='table-royal'");
  await asUser();
  assert.equal((await state()).equipped.tables, 'table-classic');
});

test('owned item remains usable when sale is hidden but disabled item falls back', async () => {
  await asUser(); await purchase('table-midnight', 350);
  await admin("UPDATE public.shop_items SET active=false WHERE id='table-midnight'");
  await asUser(); assert.equal((await state()).equipped.tables, 'table-midnight');
  await admin("UPDATE public.shop_items SET enabled=false WHERE id='table-midnight'");
  await asUser(); assert.equal((await state()).equipped.tables, 'table-classic');
});

test('shared multiplayer resolver respects effective entitlement and current DB price', async () => {
  await asUser(); await purchase('table-emerald-ivory', 900);
  await db.exec('RESET ROLE; SET ROLE service_role');
  let row = (await db.query(`SELECT * FROM shop_private.resolve_multiplayer_cosmetic('${alice}','tables')`)).rows[0];
  assert.equal(row.asset_key, 'table-emerald-ivory');
  assert.equal(Number(row.price_gem), 900);
  await db.exec('RESET ROLE');
  await admin("UPDATE public.shop_items SET price_gem=975 WHERE id='table-emerald-ivory'");
  await db.exec('SET ROLE service_role');
  row = (await db.query(`SELECT * FROM shop_private.resolve_multiplayer_cosmetic('${alice}','tables')`)).rows[0];
  assert.equal(Number(row.price_gem), 975);
});

test('legacy generic multiplayer RPCs are absent', async () => {
  const rows = (await db.query(`SELECT proname FROM pg_proc WHERE proname IN ('get_multiplayer_room_table','get_multiplayer_room_cosmetics')`)).rows;
  assert.deepEqual(rows, []);
});


const roomId = '33333333-3333-4333-8333-333333333333';
const charlie = '44444444-4444-4444-8444-444444444444';
const dana = '55555555-5555-4555-8555-555555555555';
const games = [
  { name: 'Okey', rooms: 'okey.matches', players: 'okey.match_seats', roomKey: 'match_id', released: 'membership_released_at', category: 'tables', premium: 'table-royal', classic: 'table-classic', price: 520, started: 'playing' },
  { name: 'Domino 1v1', rooms: 'public.one_vs_one_rooms', players: 'public.one_vs_one_players', roomKey: 'room_id', released: 'left_at', category: 'domino-skins', premium: 'domino-emerald-ivory', classic: 'domino-classic', price: 430, started: 'active', mode: '1v1' },
  { name: 'Domino 2v2', rooms: 'public.two_vs_two_rooms', players: 'public.two_vs_two_players', roomKey: 'room_id', released: 'left_at', category: 'domino-skins', premium: 'domino-emerald-ivory', classic: 'domino-classic', price: 430, started: 'active', mode: '2v2' },
];
function defaultPlayerKeys(game) {
  return game.mode === '1v1' ? {} : { [charlie]: game.classic, [dana]: game.classic };
}
async function seedRoom(game) {
  await admin(`INSERT INTO ${game.rooms}(id,status) VALUES ('${roomId}','waiting');
    INSERT INTO ${game.players}(${game.roomKey},user_id) VALUES ('${roomId}','${alice}'),('${roomId}','${bob}');`);
  if (game.mode !== '1v1') {
    await admin(`INSERT INTO auth.users VALUES ('${charlie}'),('${dana}');
      INSERT INTO ${game.players}(${game.roomKey},user_id) VALUES ('${roomId}','${charlie}'),('${roomId}','${dana}');`);
  }
}
async function resolveRoom(game) {
  await db.exec('RESET ROLE');
  if (!game.mode) {
    await db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
    await db.exec('SET ROLE service_role');
    return (await db.query('SELECT public.resolve_okey_match_cosmetics($1) AS value', [roomId])).rows[0].value;
  }
  await asUser();
  return (await db.query('SELECT public.resolve_domino_room_cosmetics($1,$2) AS value', [roomId, game.mode])).rows[0].value;
}
for (const game of games) {
  test(`${game.name}: authoritative cosmetics freeze at lock and survive equip, price and membership changes`, async () => {
    await asUser(); await purchase(game.premium, game.price);
    await seedRoom(game);
    const expected = { shared_set_asset_key: game.premium, player_set_asset_keys: { ...defaultPlayerKeys(game), [alice]: game.premium, [bob]: game.classic } };
    assert.deepEqual(await resolveRoom(game), game.mode ? { ...expected, locked: true } : expected);
    expected.locked = true;
    await admin(`UPDATE ${game.rooms} SET status='${game.started}' WHERE id='${roomId}'`);
    const stored = (await db.query(`SELECT cosmetics_snapshot FROM ${game.rooms} WHERE id=$1`, [roomId])).rows[0].cosmetics_snapshot;
    assert.deepEqual(stored, expected);
    await asUser(); await purchase(game.classic);
    await admin(`UPDATE public.shop_items SET enabled=false,price_gem=1 WHERE id='${game.premium}';
      UPDATE ${game.players} SET ${game.released}=now() WHERE user_id='${bob}';
      UPDATE ${game.rooms} SET cosmetics_snapshot='{}'::jsonb,status='finished' WHERE id='${roomId}';`);
    assert.deepEqual(await resolveRoom(game), expected);
    await db.exec('RESET ROLE');
    assert.deepEqual((await db.query(`SELECT cosmetics_snapshot FROM ${game.rooms} WHERE id=$1`, [roomId])).rows[0].cosmetics_snapshot, expected);
  });
  test(`${game.name}: full roster locks before gameplay and promotion expiry cannot change the snapshot`, async () => {
    await admin(`UPDATE public.shop_items SET free_from=now()-interval '1 hour',free_until=now()+interval '1 hour' WHERE id='${game.premium}'`);
    await asUser(); await purchase(game.premium);
    await seedRoom(game);
    if (!game.mode) await admin(`UPDATE okey.matches SET countdown_deadline_at=now()+interval '5 seconds' WHERE id='${roomId}'`);
    const locked = await resolveRoom(game);
    assert.equal(locked.locked, true);
    assert.equal(locked.shared_set_asset_key, game.premium);
    await asUser(); await purchase(game.classic);
    await admin(`UPDATE public.shop_items SET free_until=now()-interval '1 second',price_gem=999 WHERE id='${game.premium}';
      UPDATE ${game.players} SET ${game.released}=now() WHERE user_id='${bob}';`);
    assert.deepEqual(await resolveRoom(game), locked);
    await admin(`UPDATE ${game.rooms} SET status='${game.started}' WHERE id='${roomId}'`);
    assert.deepEqual(await resolveRoom(game), locked);
  });
  test(`${game.name}: resolver rejects unauthorized callers`, async () => {
    await seedRoom(game);
    if (game.mode) {
      await admin(`UPDATE ${game.players} SET ${game.released}=now() WHERE user_id='${alice}'`);
      await asUser();
      await assert.rejects(db.query('SELECT public.resolve_domino_room_cosmetics($1,$2)', [roomId, game.mode]), /active_room_membership_required/);
    } else {
      await asUser();
      await assert.rejects(db.query('SELECT public.resolve_okey_match_cosmetics($1)', [roomId]), /permission denied/);
    }
  });
}


test('owned unpriced retired item has the same entitlement in Shop and Multiplayer', async () => {
  await asUser(); await purchase('table-royal', 520);
  await admin("UPDATE public.shop_items SET active=false,price_gem=NULL WHERE id='table-royal'");
  await asUser(); assert.equal((await state()).equipped.tables, 'table-royal');
  assert.equal((await purchase('table-royal')).status, 'equipped');
  await db.exec('RESET ROLE; SET ROLE service_role');
  const row = (await db.query(`SELECT * FROM shop_private.resolve_multiplayer_cosmetic('${alice}','tables')`)).rows[0];
  assert.equal(row.asset_key, 'table-royal'); assert.equal(Number(row.price_gem), 0);
});

test('insufficient Gem and missing expected price do not mutate ownership, equip or ledger', async () => {
  await admin(`UPDATE public.wallets SET gem=1 WHERE user_id='${alice}'`);
  await asUser();
  assert.equal((await purchase('table-royal')).status, 'price_changed');
  assert.equal((await purchase('table-royal',520)).status, 'insufficient_gems');
  assert.equal((await state()).equipped.tables, 'table-classic');
  assert.equal(await count('wallet_transactions'), 0);
  assert.equal(await count('user_shop_items', `user_id='${alice}' AND item_id='table-royal'`), 0);
});

test('a ledger failure rolls back Gem, ownership and equip', async () => {
  await admin(`CREATE FUNCTION public.fail_shop_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test_ledger_failure'; END $$;
    CREATE TRIGGER fail_shop_ledger BEFORE INSERT ON public.wallet_transactions FOR EACH ROW EXECUTE FUNCTION public.fail_shop_ledger();`);
  await asUser(); await db.exec('SAVEPOINT purchase_attempt');
  await assert.rejects(purchase('table-royal',520), /test_ledger_failure/);
  await db.exec('ROLLBACK TO SAVEPOINT purchase_attempt');
  assert.equal((await state()).equipped.tables, 'table-classic');
  await db.exec('RESET ROLE');
  assert.equal(Number((await db.query(`SELECT gem FROM public.wallets WHERE user_id='${alice}'`)).rows[0].gem), 5000);
  assert.equal(await count('user_shop_items', `user_id='${alice}' AND item_id='table-royal'`), 0);
});

test('base free claims remain owned after a subsequent price increase', async () => {
  await admin("UPDATE public.shop_items SET price_gem=0 WHERE id='table-royal'");
  await asUser(); assert.equal((await purchase('table-royal')).status, 'claimed');
  await admin("UPDATE public.shop_items SET price_gem=999 WHERE id='table-royal'");
  await asUser(); assert.equal((await purchase('table-royal')).status, 'equipped');
  assert.equal(await count('wallet_transactions'), 0);
  assert.equal(await count('user_shop_items', `user_id='${alice}' AND item_id='table-royal'`), 1);
});

test('Shop ACL removes inherited table privileges and RLS exposes only own ownership/equip', async () => {
  for (const table of ['shop_items','user_shop_items','user_equipped_shop_items']) {
    for (const role of ['anon','authenticated']) {
      for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
        assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) AS allowed',[role,`public.${table}`,privilege])).rows[0].allowed,false);
      }
    }
  }
  await asUser();
  for (const table of ['user_shop_items','user_equipped_shop_items']) {
    const rows = (await db.query(`SELECT user_id FROM public.${table}`)).rows;
    assert.equal(rows.length,2); assert.ok(rows.every(row => row.user_id===alice));
  }
});

for (const game of games) {
  test(`${game.name}: started room without a snapshot fails closed instead of recomputing live cosmetics`, async () => {
    // Represents historical data predating the snapshot triggers.
    await admin(`INSERT INTO ${game.rooms}(id,status) VALUES ('${roomId}','${game.started}');
      INSERT INTO ${game.players}(${game.roomKey},user_id) VALUES ('${roomId}','${alice}');`);
    await assert.rejects(resolveRoom(game), /cosmetics_snapshot_missing/);
  });
}
