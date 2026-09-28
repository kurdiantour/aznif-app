import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

export const migrationName = '20260928011225_shared_multiplayer_match_stats';
export const users = [1, 2, 3, 4].map(n => `${n.toString().repeat(8)}-1111-4111-8111-${n.toString().repeat(12)}`);
export const source = name => readFileSync(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
export function functionSql(file, name) {
  const sql = source(file);
  const start = sql.search(new RegExp(`create or replace function (?:public\\.|okey\\.)${name}\\s*\\(`, 'i'));
  if (start < 0) throw new Error(`Missing ${name} in ${file}`);
  const body = sql.slice(start);
  const tag = body.match(/\$(?:function)?\$/)?.[0];
  return body.slice(0, body.indexOf(tag, body.indexOf(tag) + tag.length) + tag.length + 1);
}

export async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      points integer DEFAULT 100, games_played integer DEFAULT 0, games_won integer DEFAULT 0,
      games_lost integer DEFAULT 0, updated_at timestamptz DEFAULT now());
    CREATE TABLE public.wallets(user_id uuid PRIMARY KEY, coin numeric DEFAULT 10000,
      mc numeric DEFAULT 10000, gem numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE public.domino_fun_match_rewards(mode text, room_id uuid, user_id uuid,
      team_id text, point_delta integer, gem_delta numeric, PRIMARY KEY(mode,room_id,user_id));
    CREATE TABLE public.domino_wallet_ledger(id uuid DEFAULT gen_random_uuid(), user_id uuid,
      mode text, room_id uuid, currency text, amount numeric, reason text,
      idempotency_key text UNIQUE, metadata jsonb);
    SELECT set_config('request.jwt.claim.role','service_role',false);
  `);
  // Platform/table fixtures only. All lifecycle RPCs below are real repository bodies.
  for (const prefix of ['one_vs_one', 'two_vs_two']) {
    await db.exec(`
      CREATE TABLE public.${prefix}_rooms(id uuid PRIMARY KEY, status text DEFAULT 'active',
        state jsonb DEFAULT '{}', version bigint DEFAULT 0, move_sequence bigint DEFAULT 0, current_turn_player_id uuid,
        updated_at timestamptz, currency text DEFAULT 'fun', entry_fee numeric DEFAULT 0,
        prize_pool numeric DEFAULT 0, total_entry numeric DEFAULT 0, total_commission numeric DEFAULT 0,
        commission_rate numeric DEFAULT 0, commission_per_player numeric DEFAULT 0,
        economy_charged_at timestamptz DEFAULT now(), settlement_at timestamptz, settlement jsonb);
      CREATE TABLE public.${prefix}_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id uuid, user_id uuid, kind text DEFAULT 'human', team_id text, player_index integer,
        connected boolean DEFAULT true, bot_takeover boolean DEFAULT false, abandoned boolean DEFAULT false,
        left_at timestamptz, takeover_started_at timestamptz, takeover_expires_at timestamptz,
        updated_at timestamptz, consecutive_timeout_strikes integer DEFAULT 0);
      CREATE TABLE public.${prefix}_moves(id uuid DEFAULT gen_random_uuid(), room_id uuid,
        player_id uuid, sequence bigint, action text, payload jsonb, UNIQUE(room_id,sequence));
      CREATE TABLE public.${prefix}_private_states(room_id uuid PRIMARY KEY, hands jsonb,
        boneyard jsonb, updated_at timestamptz);
    `);
    await db.exec(functionSql(prefix === 'one_vs_one' ? '20260524000400_one_vs_one_core' : '20260524000700_two_vs_two_core', `next_${prefix}_move_sequence`));
  }
  await db.exec(`CREATE FUNCTION public.calculate_match_reward(integer,integer)
    RETURNS TABLE(tier text,gold numeric,points integer) LANGUAGE sql AS $$ SELECT 'normal'::text,0::numeric,35 $$;`);
  await db.exec(source('20260802000100_okey_authoritative_core'));
  await db.exec(`ALTER TABLE okey.matches ADD COLUMN is_test boolean NOT NULL DEFAULT false;`);
  await db.exec(source('20260819000100_domino_timeout_takeover'));
  await db.exec(source('20260819000200_domino_manual_leave_takeover'));
  await db.exec(source('20260820115805_domino_one_vs_one_timeout_terminal_round'));
  await db.exec(source('20260820190000_fix_one_vs_one_terminal_resolver_player_row'));
  await db.exec(source('20260820141129_domino_two_vs_two_team_takeover_terminal_round'));
  await db.exec(functionSql('20260816180000_domino_okey_takeover_economy_fix', 'domino_settle_match'));
  await db.exec(functionSql('20260810000500_domino_okey_economy', 'domino_settle_finished_room'));
  await db.exec(functionSql('20260625000100_one_vs_one_aznif_betting', 'commit_multiplayer_action'));
  await db.exec(functionSql('20260810000500_domino_okey_economy', 'settle_finished_match_rewards'));
  await db.exec(functionSql('20260810000500_domino_okey_economy', 'settle_one_vs_one_bet'));
  await db.exec(functionSql('20260821123000_fix_one_vs_one_legal_finish_settlement', 'start_one_vs_one_game'));
  for (const [prefix, mode] of [['one_vs_one','1v1'], ['two_vs_two','2v2']]) {
    await db.exec(`CREATE TRIGGER domino_settle_${mode} AFTER UPDATE OF status ON public.${prefix}_rooms
      FOR EACH ROW EXECUTE FUNCTION public.domino_settle_finished_room();`);
  }
  await db.exec(source('20260702000100_public_player_stats').split('CREATE OR REPLACE FUNCTION public.get_public_player_card')[0]);
  await db.exec(source(migrationName));
  for (const id of users) {
    await db.query('INSERT INTO auth.users VALUES ($1)', [id]);
    await db.query('INSERT INTO public.profiles(id) VALUES ($1)', [id]);
    await db.query('INSERT INTO public.wallets(user_id) VALUES ($1)', [id]);
  }
  return db;
}

export async function createDomino(db, mode, options = {}) {
  const id = options.id ?? randomUUID();
  const prefix = mode === '1v1' ? 'one_vs_one' : 'two_vs_two';
  await db.query(`INSERT INTO public.${prefix}_rooms(id,status,is_test,currency) VALUES ($1,$2,$3,$4)`,
    [id, options.status ?? 'active', options.isTest ?? false, options.currency ?? 'fun']);
  for (let i=0; i<(mode === '1v1' ? 2 : 4); i++) {
    await db.query(`INSERT INTO public.${prefix}_players(room_id,user_id,team_id,player_index) VALUES ($1,$2,$3,$4)`,
      [id, users[i], i%2 ? 'teamB' : 'teamA', i]);
  }
  return { id, mode, prefix };
}
export async function leave(db, room, index) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [users[index]]);
  return db.query(`SELECT public.leave_${room.prefix}_match($1)`, [room.id]);
}
export async function finish(db, room, winner = 'teamA', status = 'finished') {
  return db.query(`UPDATE public.${room.prefix}_rooms SET state=state || $2::jsonb,status=$3,version=version+1 WHERE id=$1`,
    [room.id, JSON.stringify({ winningTeamId: winner }), status]);
}
export async function results(db) {
  return (await db.query('SELECT game_type,user_id,outcome,reason FROM public.multiplayer_match_stat_results ORDER BY game_type,user_id')).rows;
}
export async function counters(db) {
  return (await db.query('SELECT games_played,games_won,games_lost FROM public.profiles ORDER BY id')).rows;
}
export async function createOkey(db, state, options = {}) {
  const id = options.id ?? randomUUID();
  await db.query("INSERT INTO okey.matches(id,status,is_test) VALUES ($1,'playing',$2)", [id, options.isTest ?? false]);
  await db.query('INSERT INTO okey.match_private_states(match_id,state) VALUES ($1,$2)', [id, JSON.stringify(state)]);
  for (let i=0;i<4;i++) await db.query('INSERT INTO okey.match_seats(match_id,user_id,player_index,team_id) VALUES ($1,$2,$3,$4)',
    [id,users[i],i,i%2 ? 'teamB' : 'teamA']);
  return id;
}
export async function commitOkey(db, id, state, type = 'discard', index = 0, options = {}) {
  const version = options.version ?? Number((await db.query('SELECT version FROM okey.matches WHERE id=$1',[id])).rows[0].version);
  return db.query('SELECT * FROM public.okey_commit_authoritative_command($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, users[index], options.commandId ?? randomUUID(), version, type, JSON.stringify(state), '{}',
      state.matchFinished ? 'finished' : 'playing', null]);
}
