import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, afterEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

let db;
const migration = readFileSync(new URL('../supabase/migrations/20261015000100_dama_matchmaking_bots.sql', import.meta.url), 'utf8');
const human = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const matchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA multiplayer_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT COALESCE(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')
    $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id), username text, avatar_id text,
      avatar_url text, points integer NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
    CREATE TABLE public.wallets(user_id uuid PRIMARY KEY REFERENCES auth.users(id), coin numeric NOT NULL DEFAULT 0,
      gem numeric NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
    CREATE TABLE public.dama_matches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL,
      version bigint NOT NULL DEFAULT 0, state jsonb, current_turn_user_id uuid, winner_user_id uuid,
      finish_reason text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
      countdown_deadline_at timestamptz, settlement jsonb, settlement_at timestamptz);
    CREATE TABLE public.dama_match_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      match_id uuid NOT NULL REFERENCES public.dama_matches(id) ON DELETE CASCADE,
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, player_index smallint NOT NULL,
      piece_color text NOT NULL, connected boolean NOT NULL DEFAULT true, bot_takeover boolean NOT NULL DEFAULT false,
      manual_left boolean NOT NULL DEFAULT false, left_at timestamptz, joined_at timestamptz DEFAULT now(),
      last_seen_at timestamptz DEFAULT now(), consecutive_timeout_strikes integer NOT NULL DEFAULT 0,
      UNIQUE(match_id,player_index), UNIQUE(match_id,user_id));
    CREATE TABLE public.dama_match_economy(match_id uuid PRIMARY KEY REFERENCES public.dama_matches(id),
      currency text DEFAULT 'coin', entry_fee integer DEFAULT 500, total_entry integer DEFAULT 1000,
      commission integer DEFAULT 0, charged_at timestamptz, settled_at timestamptz, settlement jsonb);
    CREATE TABLE public.dama_wallet_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid,
      user_id uuid, amount integer, reason text, idempotency_key text UNIQUE, metadata jsonb DEFAULT '{}'::jsonb,
      UNIQUE(match_id,user_id,reason));
    CREATE TABLE public.dama_fun_match_rewards(match_id uuid,user_id uuid,piece_color text,point_delta integer,
      gem_delta numeric,created_at timestamptz DEFAULT now(),PRIMARY KEY(match_id,user_id));
    CREATE TABLE public.dama_match_moves(match_id uuid,version bigint,user_id uuid,action text,payload jsonb DEFAULT '{}'::jsonb);
    CREATE TABLE multiplayer_private.stats_calls(match_id uuid,version bigint,event_type text,results jsonb);
    CREATE FUNCTION multiplayer_private.record_player_results(text,uuid,bigint,text,jsonb) RETURNS void
      LANGUAGE plpgsql AS $$ BEGIN INSERT INTO multiplayer_private.stats_calls VALUES($2,$3,$4,$5); END $$;
    CREATE FUNCTION multiplayer_private.record_dama_final_stats(uuid,uuid DEFAULT NULL) RETURNS void
      LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION public.is_dama_match_member(uuid,uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION public.dama_charge_entry_fee(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.dama_settle_match(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.dama_start_match(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION public.find_dama_match() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.get_dama_match_snapshot(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    INSERT INTO auth.users(id) VALUES ('${human}'),('${other}');
    INSERT INTO public.profiles(id,username,points) VALUES ('${human}','Human',20),('${other}','Other',20);
    INSERT INTO public.wallets(user_id,coin,gem) VALUES ('${human}',2000,3),('${other}',2000,4);
  `);
  await db.exec(migration);
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec('BEGIN');
  await db.query('SELECT set_config($1,$2,true)', ['request.jwt.claim.sub', human]);
  await db.query('SELECT set_config($1,$2,true)', ['request.jwt.claim.role', 'authenticated']);
});
afterEach(async () => db.exec('ROLLBACK'));

test('migration installs a disabled 25-bot pool and matchmaking uses a server deadline', async () => {
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.dama_bot_profiles')).rows[0].n, 25);
  assert.equal((await db.query('SELECT matchmaking_enabled FROM public.dama_bot_settings WHERE singleton')).rows[0].matchmaking_enabled, false);
  const noBot = (await db.query('SELECT public.find_dama_match() AS result')).rows[0].result;
  assert.equal(noBot.status, 'searching');
  assert.equal(noBot.matchmaking_deadline_at, null);
  await db.query('DELETE FROM public.dama_matches WHERE id=$1',[noBot.match_id]);

  await db.query('UPDATE public.dama_bot_settings SET matchmaking_enabled=true WHERE singleton');
  await db.query('SELECT set_config($1,$2,true)', ['request.jwt.claim.sub', other]);
  const enabled = (await db.query('SELECT public.find_dama_match() AS result')).rows[0].result;
  assert.equal(enabled.status, 'searching');
  assert.ok(Date.parse(enabled.matchmaking_deadline_at) > Date.now());
  assert.ok(Date.parse(enabled.matchmaking_deadline_at) - Date.now() <= 16_000);
});

test('due assignment starts a bot match, charges both ledgers, commits bot moves and settles a bot win', async () => {
  await db.query('UPDATE public.dama_bot_settings SET matchmaking_enabled=true WHERE singleton');
  await db.query('INSERT INTO public.dama_matches(id,status,matchmaking_deadline_at) VALUES($1,\'waiting\',now()-interval \'1 second\')',[matchId]);
  await db.query(`INSERT INTO public.dama_match_players(match_id,user_id,player_index,piece_color)
    VALUES($1,$2,0,'cream')`,[matchId,human]);
  await db.query('SELECT set_config($1,$2,true)', ['request.jwt.claim.role', 'service_role']);
  const assigned=(await db.query('SELECT public.dama_fill_waiting_with_bot($1) AS result',[matchId])).rows[0].result;
  assert.equal(assigned.assigned,true);
  const bot=(await db.query('SELECT bot_profile_id FROM public.dama_match_players WHERE match_id=$1 AND bot_profile_id IS NOT NULL',[matchId])).rows[0].bot_profile_id;
  await db.query('SELECT public.dama_start_match_service($1)',[matchId]);
  assert.equal((await db.query('SELECT status FROM public.dama_matches WHERE id=$1',[matchId])).rows[0].status,'active');
  assert.equal(Number((await db.query('SELECT coin FROM public.wallets WHERE user_id=$1',[human])).rows[0].coin),1500);
  assert.equal(Number((await db.query('SELECT coin_balance FROM public.dama_bot_profiles WHERE id=$1',[bot])).rows[0].coin_balance),99500);

  const gameState={pieces:[],turn:'black',ply:1,result:null,quietPly:0,history:{},timeoutStrikes:{cream:0,black:0},turnStartedAtMs:0,turnDeadlineAtMs:15000};
  await db.query(`UPDATE public.dama_matches SET state=$2,current_turn_user_id=NULL WHERE id=$1`,[matchId,gameState]);
  const committed=(await db.query(`SELECT public.commit_dama_bot_action($1,2,$2,$3,$4,'{}'::jsonb) AS result`,
    [matchId,bot,{...gameState,turn:'cream',ply:2},human])).rows[0].result;
  assert.equal(committed.status,'active');
  assert.equal((await db.query("SELECT action FROM public.dama_match_moves WHERE match_id=$1 ORDER BY version DESC LIMIT 1",[matchId])).rows[0].action,'bot-move');

  const finalState={...gameState,turn:'cream',result:{winner:'black',reason:'no-pieces'}};
  await db.query(`UPDATE public.dama_matches SET status='finished',state=$2,finish_reason='no-pieces' WHERE id=$1`,[matchId,finalState]);
  const settlement=(await db.query('SELECT public.dama_settle_match($1) AS result',[matchId])).rows[0].result;
  assert.equal(settlement.botWon,true);
  assert.equal(settlement.payout,0);
  assert.equal(Number((await db.query('SELECT coin FROM public.wallets WHERE user_id=$1',[human])).rows[0].coin),1500);
  assert.equal(Number((await db.query('SELECT points FROM public.profiles WHERE id=$1',[human])).rows[0].points),5);
  const botBalance=(await db.query('SELECT coin_balance,gem_balance,points FROM public.dama_bot_profiles WHERE id=$1',[bot])).rows[0];
  assert.equal(Number(botBalance.coin_balance),100500);
  assert.equal(Number(botBalance.gem_balance),10);
  assert.equal(Number(botBalance.points),35);
  await db.query('SELECT multiplayer_private.record_dama_final_stats($1)',[matchId]);
  assert.equal((await db.query('SELECT results->0->>\'outcome\' AS outcome FROM multiplayer_private.stats_calls WHERE match_id=$1',[matchId])).rows[0].outcome,'loss');
});

test('human win pays the human and records bot Coin loss, Gem/point result idempotently', async () => {
  const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const bot=(await db.query('SELECT id FROM public.dama_bot_profiles ORDER BY id LIMIT 1')).rows[0].id;
  await db.query("INSERT INTO public.dama_matches(id,status,countdown_deadline_at) VALUES($1,'waiting',now()-interval '1 second')",[id]);
  await db.query(`INSERT INTO public.dama_match_players(match_id,user_id,player_index,piece_color)
    VALUES($1,$2,0,'cream')`,[id,human]);
  await db.query(`INSERT INTO public.dama_match_players(match_id,bot_profile_id,player_index,piece_color)
    VALUES($1,$2,1,'black')`,[id,bot]);
  await db.query('SELECT set_config($1,$2,true)', ['request.jwt.claim.role', 'service_role']);
  await db.query('SELECT public.dama_start_match_service($1)',[id]);
  const state={result:{winner:'cream',reason:'no-pieces'}};
  await db.query("UPDATE public.dama_matches SET status='finished',state=$2,winner_user_id=$3,finish_reason='no-pieces' WHERE id=$1",[id,state,human]);
  const once=(await db.query('SELECT public.dama_settle_match($1) AS result',[id])).rows[0].result;
  const twice=(await db.query('SELECT public.dama_settle_match($1) AS result',[id])).rows[0].result;
  assert.deepEqual(twice,once);
  assert.equal(once.payout,1000);
  assert.equal(Number((await db.query('SELECT coin FROM public.wallets WHERE user_id=$1',[human])).rows[0].coin),2500);
  assert.equal(Number((await db.query('SELECT gem FROM public.wallets WHERE user_id=$1',[human])).rows[0].gem),13);
  const botBalance=(await db.query('SELECT coin_balance,gem_balance,points FROM public.dama_bot_profiles WHERE id=$1',[bot])).rows[0];
  assert.equal(Number(botBalance.coin_balance),99500);
  assert.equal(Number(botBalance.gem_balance),0);
  assert.equal(Number(botBalance.points),0);
});

test('existing human-vs-human countdown starts and charges both real wallets', async () => {
  const id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await db.query("INSERT INTO public.dama_matches(id,status,countdown_deadline_at) VALUES($1,'waiting',now()-interval '1 second')",[id]);
  await db.query(`INSERT INTO public.dama_match_players(match_id,user_id,player_index,piece_color)
    VALUES($1,$2,0,'cream'),($1,$3,1,'black')`,[id,human,other]);
  await db.query('SELECT public.dama_start_match($1)',[id]);
  assert.equal((await db.query('SELECT status FROM public.dama_matches WHERE id=$1',[id])).rows[0].status,'active');
  assert.deepEqual((await db.query('SELECT coin FROM public.wallets WHERE user_id IN ($1,$2) ORDER BY user_id',[human,other])).rows.map(row=>Number(row.coin)),[1500,1500]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.dama_wallet_ledger WHERE match_id=$1',[id])).rows[0].n,2);
});
