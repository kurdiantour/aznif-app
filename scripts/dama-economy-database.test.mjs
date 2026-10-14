import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, afterEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

let db;
const migration = readFileSync(new URL('../supabase/migrations/20261011000200_dama_fun_match_rewards.sql', import.meta.url), 'utf8');
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const winnerMatch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const noWinnerMatch = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id), points integer NOT NULL DEFAULT 0, updated_at timestamptz);
    CREATE TABLE public.wallets(user_id uuid PRIMARY KEY REFERENCES auth.users(id), coin numeric NOT NULL DEFAULT 0, gem numeric NOT NULL DEFAULT 0, updated_at timestamptz);
    CREATE TABLE public.dama_matches(
      id uuid PRIMARY KEY, status text NOT NULL, winner_user_id uuid, finish_reason text,
      settlement jsonb, settlement_at timestamptz
    );
    CREATE TABLE public.dama_match_players(
      match_id uuid NOT NULL REFERENCES public.dama_matches(id), user_id uuid REFERENCES auth.users(id),
      piece_color text NOT NULL, left_at timestamptz
    );
    CREATE TABLE public.dama_match_economy(
      match_id uuid PRIMARY KEY REFERENCES public.dama_matches(id), charged_at timestamptz,
      settled_at timestamptz, settlement jsonb
    );
    CREATE TABLE public.dama_wallet_ledger(
      match_id uuid NOT NULL, user_id uuid NOT NULL, amount integer NOT NULL,
      reason text NOT NULL, idempotency_key text NOT NULL UNIQUE, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    INSERT INTO auth.users VALUES ('${alice}'),('${bob}');
    INSERT INTO public.profiles(id,points) VALUES ('${alice}',20),('${bob}',4);
    INSERT INTO public.wallets(user_id,coin,gem) VALUES ('${alice}',4500,3),('${bob}',4500,7);
  `);
  await db.exec(migration);
});
after(async () => db?.close());
beforeEach(async () => db.exec('BEGIN'));
afterEach(async () => db.exec('ROLLBACK'));

async function insertMatch(id, winner, reason) {
  await db.query(`INSERT INTO public.dama_matches(id,status,winner_user_id,finish_reason) VALUES ($1,'finished',$2,$3)`, [id,winner,reason]);
  await db.query(`INSERT INTO public.dama_match_players(match_id,user_id,piece_color) VALUES ($1,$2,'cream'),($1,$3,'black')`, [id,alice,bob]);
  await db.query(`INSERT INTO public.dama_match_economy(match_id,charged_at) VALUES ($1,now())`, [id]);
}

test('winner settlement credits 1000 Coin, 10 Gems and 35 points once; loser loses only 15 points, clamped at zero', async () => {
  await insertMatch(winnerMatch,alice,'no-pieces');
  const first = (await db.query('SELECT public.dama_settle_match($1) AS result',[winnerMatch])).rows[0].result;
  const balances = (await db.query(`SELECT p.id,p.points,w.coin,w.gem FROM public.profiles p JOIN public.wallets w ON w.user_id=p.id ORDER BY p.id`)).rows;
  assert.deepEqual(balances.map((r) => [Number(r.points),Number(r.coin),Number(r.gem)]), [[55,5500,13],[0,4500,7]]);
  assert.equal(first.payout,1000);
  assert.equal(first.winnerPointDelta,35);
  assert.equal(first.winnerGemDelta,10);
  assert.equal(first.loserPointDelta,-15);

  const second = (await db.query('SELECT public.dama_settle_match($1) AS result',[winnerMatch])).rows[0].result;
  assert.deepEqual(second,first);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.dama_wallet_ledger WHERE match_id=$1',[winnerMatch])).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.dama_fun_match_rewards WHERE match_id=$1',[winnerMatch])).rows[0].n,2);
});

test('no-winner settlement follows Domino: no payout, gems, or points; canceled/refunded matches cannot be settled', async () => {
  await insertMatch(noWinnerMatch,null,'both-bot-takeover');
  const result = (await db.query('SELECT public.dama_settle_match($1) AS result',[noWinnerMatch])).rows[0].result;
  assert.equal(result.type,'no_winner');
  assert.equal(result.payout,0);
  assert.equal(result.pointDelta,0);
  assert.equal(result.gemDelta,0);
  assert.deepEqual((await db.query('SELECT points FROM public.profiles ORDER BY id')).rows.map((r) => Number(r.points)),[20,4]);
  assert.deepEqual((await db.query('SELECT coin,gem FROM public.wallets ORDER BY user_id')).rows.map((r) => [Number(r.coin),Number(r.gem)]),[[4500,3],[4500,7]]);

  const cancelled='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await db.query(`INSERT INTO public.dama_matches(id,status,finish_reason) VALUES ($1,'cancelled','cancelled')`,[cancelled]);
  await db.query('INSERT INTO public.dama_match_economy(match_id,charged_at) VALUES ($1,now())',[cancelled]);
  await db.exec('SAVEPOINT cancelled_settlement');
  await assert.rejects(db.query('SELECT public.dama_settle_match($1)',[cancelled]),/dama_match_not_finished/);
  await db.exec('ROLLBACK TO SAVEPOINT cancelled_settlement');
});

test('missing profile rolls back coin, gems, points, ledger, and settlement together', async () => {
  const id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await insertMatch(id,alice,'no-pieces');
  await db.query('DELETE FROM public.profiles WHERE id=$1',[bob]);
  await db.exec('SAVEPOINT failed_settlement');
  await assert.rejects(db.query('SELECT public.dama_settle_match($1)',[id]),/profile_not_initialized/);
  await db.exec('ROLLBACK TO SAVEPOINT failed_settlement');
  assert.equal(Number((await db.query('SELECT coin FROM public.wallets WHERE user_id=$1',[alice])).rows[0].coin),4500);
  assert.equal(Number((await db.query('SELECT gem FROM public.wallets WHERE user_id=$1',[alice])).rows[0].gem),3);
  assert.equal((await db.query('SELECT settled_at FROM public.dama_match_economy WHERE match_id=$1',[id])).rows[0].settled_at,null);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.dama_wallet_ledger WHERE match_id=$1',[id])).rows[0].n,0);
});
