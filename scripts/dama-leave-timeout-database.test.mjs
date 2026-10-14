import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, afterEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

let db;
const migration = readFileSync(new URL('../supabase/migrations/20261014000100_dama_manual_leave_forfeit.sql', import.meta.url), 'utf8');
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const manualMatch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const timeoutMatch = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA multiplayer_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.dama_matches (
      id uuid PRIMARY KEY, status text NOT NULL, state jsonb NOT NULL,
      current_turn_user_id uuid, winner_user_id uuid, finish_reason text,
      settlement jsonb, version bigint NOT NULL DEFAULT 1, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.dama_match_players (
      id uuid PRIMARY KEY, match_id uuid NOT NULL, user_id uuid NOT NULL,
      player_index integer NOT NULL, piece_color text NOT NULL,
      bot_takeover boolean NOT NULL DEFAULT false, manual_left boolean NOT NULL DEFAULT false,
      left_at timestamptz, connected boolean NOT NULL DEFAULT true,
      last_seen_at timestamptz DEFAULT now(), consecutive_timeout_strikes integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.dama_match_moves (
      match_id uuid, version bigint, user_id uuid, action text, payload jsonb
    );
    CREATE TABLE public.dama_fun_match_rewards (
      match_id uuid, user_id uuid, piece_color text, point_delta integer, gem_delta numeric,
      PRIMARY KEY(match_id,user_id)
    );
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, points integer NOT NULL DEFAULT 0, updated_at timestamptz);
    CREATE TABLE public.lifecycle_calls (match_id uuid);
    CREATE TABLE public.dama_match_economy (match_id uuid PRIMARY KEY, settlement jsonb);
    CREATE TABLE multiplayer_private.stats_calls (match_id uuid, results jsonb, event_type text);
    CREATE FUNCTION public.dama_settle_match(p_match_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO public.lifecycle_calls VALUES(p_match_id);
      UPDATE public.dama_match_economy SET settlement='{"type":"winner","loserPointDelta":-15}'::jsonb WHERE match_id=p_match_id;
      UPDATE public.dama_matches SET settlement='{"type":"winner","loserPointDelta":-15}'::jsonb WHERE id=p_match_id;
      RETURN '{"type":"winner","loserPointDelta":-15}'::jsonb;
    END $$;
    CREATE FUNCTION multiplayer_private.record_player_results(p_game text, p_match_id uuid, p_version bigint,
      p_event_type text, p_results jsonb) RETURNS void LANGUAGE sql AS $$
      INSERT INTO multiplayer_private.stats_calls VALUES(p_match_id,p_results,p_event_type)
    $$;
    INSERT INTO public.profiles(id,points) VALUES ('${alice}',80),('${bob}',80);
    INSERT INTO public.dama_matches(id,status,state,current_turn_user_id,version)
      VALUES ('${manualMatch}','active',
        '{"turn":"cream","ply":7,"pieces":[{"id":"p","row":3,"column":3}],"timeoutStrikes":{"cream":2},"turnDeadlineAtMs":1000}',
        '${alice}',8);
    INSERT INTO public.dama_match_players(id,match_id,user_id,player_index,piece_color)
      VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${manualMatch}','${alice}',0,'cream'),
             ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','${manualMatch}','${bob}',1,'black');
    INSERT INTO public.dama_match_economy(match_id,settlement) VALUES ('${manualMatch}','{}');
    INSERT INTO public.dama_matches(id,status,state,current_turn_user_id,version)
      VALUES ('${timeoutMatch}','active',
        '{"turn":"cream","ply":9,"pieces":[{"id":"keep","row":4,"column":2}],"timeoutStrikes":{"cream":2},"turnDeadlineAtMs":1000}',
        '${alice}',12);
    INSERT INTO public.dama_match_players(id,match_id,user_id,player_index,piece_color,bot_takeover,consecutive_timeout_strikes)
      VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','${timeoutMatch}','${alice}',0,'cream',true,2),
             ('ffffffff-ffff-4fff-8fff-ffffffffffff','${timeoutMatch}','${bob}',1,'black',false,0);
  `);
  await db.exec(migration);
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec('BEGIN');
  await db.query('SELECT set_config($1,$2,true)', ['request.jwt.claim.sub', alice]);
});
afterEach(async () => db.exec('ROLLBACK'));

test('manual leave is a final forfeit, releases membership, settles, and cannot restore', async () => {
  await db.query('SELECT public.dama_leave_match($1)', [manualMatch]);

  const match = (await db.query('SELECT status,winner_user_id,finish_reason,state,version FROM public.dama_matches WHERE id=$1', [manualMatch])).rows[0];
  assert.equal(match.status, 'finished');
  assert.equal(match.winner_user_id, bob);
  assert.equal(match.finish_reason, 'manual-leave');
  assert.deepEqual(match.state.result, { winner: 'black', reason: 'manual-leave' });
  assert.equal(match.state.turnDeadlineAtMs, null);

  const leaver = (await db.query('SELECT left_at,manual_left,bot_takeover,connected FROM public.dama_match_players WHERE match_id=$1 AND user_id=$2', [manualMatch, alice])).rows[0];
  assert.ok(leaver.left_at);
  assert.equal(leaver.manual_left, true);
  assert.equal(leaver.bot_takeover, false);
  assert.equal(leaver.connected, false);
  assert.equal(Number((await db.query('SELECT points FROM public.profiles WHERE id=$1', [alice])).rows[0].points), 55);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.lifecycle_calls WHERE match_id=$1', [manualMatch])).rows[0].n, 1);
  const settlement = (await db.query('SELECT settlement FROM public.dama_matches WHERE id=$1', [manualMatch])).rows[0].settlement;
  assert.equal(settlement.manualLeaverUserId, alice);
  assert.equal(settlement.manualLeavePointDelta, -25);
  assert.equal((await db.query('SELECT settlement FROM public.dama_match_economy WHERE match_id=$1', [manualMatch])).rows[0].settlement.manualLeavePointDelta, -25);

  const action = (await db.query('SELECT action,payload FROM public.dama_match_moves WHERE match_id=$1', [manualMatch])).rows[0];
  assert.equal(action.action, 'manual-leave');
  assert.equal(action.payload.manual_left, true);
  assert.equal(action.payload.bot_takeover, false);
  const stats = (await db.query('SELECT event_type,results FROM multiplayer_private.stats_calls WHERE match_id=$1', [manualMatch])).rows[0];
  assert.equal(stats.event_type, 'manual_leave');
  assert.deepEqual(stats.results.map(({ user_id, outcome, reason }) => ({ user_id, outcome, reason })).sort((a, b) => a.user_id.localeCompare(b.user_id)), [
    { user_id: alice, outcome: 'loss', reason: 'manual_leave' },
    { user_id: bob, outcome: 'win', reason: 'match_finished' },
  ]);
  await assert.rejects(db.query('SELECT public.dama_restore_control($1)', [manualMatch]), /dama_match_not_active/);
});

test('timeout takeover can restore the same seat without reverting committed bot game state', async () => {
  const before = (await db.query('SELECT state FROM public.dama_matches WHERE id=$1', [timeoutMatch])).rows[0].state;
  await db.query('SELECT public.dama_restore_control($1)', [timeoutMatch]);

  const player = (await db.query('SELECT left_at,manual_left,bot_takeover,connected,consecutive_timeout_strikes FROM public.dama_match_players WHERE match_id=$1 AND user_id=$2', [timeoutMatch, alice])).rows[0];
  assert.equal(player.left_at, null);
  assert.equal(player.manual_left, false);
  assert.equal(player.bot_takeover, false);
  assert.equal(player.connected, true);
  assert.equal(player.consecutive_timeout_strikes, 0);
  const after = (await db.query('SELECT status,state,version FROM public.dama_matches WHERE id=$1', [timeoutMatch])).rows[0];
  assert.equal(after.status, 'active');
  assert.equal(after.version, 13);
  assert.equal(after.state.turn, before.turn);
  assert.equal(after.state.ply, before.ply);
  assert.deepEqual(after.state.pieces, before.pieces);
  assert.equal(after.state.turnDeadlineAtMs > before.turnDeadlineAtMs, true);
  assert.equal((await db.query('SELECT action FROM public.dama_match_moves WHERE match_id=$1', [timeoutMatch])).rows[0].action, 'restore-control');
});
