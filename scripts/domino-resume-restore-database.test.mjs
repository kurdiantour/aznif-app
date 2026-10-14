import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, afterEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

let db;
const migration = readFileSync(new URL('../supabase/migrations/20261011212105_domino_one_vs_one_resume_restore.sql', import.meta.url), 'utf8');
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const room = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql VOLATILE AS $$ SELECT '11111111-1111-4111-8111-111111111111'::uuid $$;
    CREATE TABLE public.one_vs_one_rooms (
      id uuid PRIMARY KEY, status text NOT NULL, state jsonb NOT NULL DEFAULT '{}',
      version integer NOT NULL DEFAULT 8, currency text NOT NULL DEFAULT 'fun',
      entry_fee numeric NOT NULL DEFAULT 500, move_sequence integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.one_vs_one_players (
      id uuid PRIMARY KEY, room_id uuid NOT NULL, user_id uuid, kind text NOT NULL,
      abandoned boolean NOT NULL DEFAULT false, left_at timestamptz,
      bot_takeover boolean NOT NULL DEFAULT false, takeover_started_at timestamptz,
      takeover_expires_at timestamptz, connected boolean NOT NULL DEFAULT false,
      last_seen_at timestamptz, consecutive_timeout_strikes integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.one_vs_one_moves (
      room_id uuid NOT NULL, player_id uuid, sequence integer NOT NULL,
      action text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
      UNIQUE(room_id, sequence)
    );
    CREATE FUNCTION public.next_one_vs_one_move_sequence(p_room_id uuid) RETURNS integer
    LANGUAGE plpgsql AS $$ DECLARE n integer; BEGIN
      UPDATE public.one_vs_one_rooms SET move_sequence=move_sequence+1 WHERE id=p_room_id RETURNING move_sequence INTO n;
      RETURN n;
    END $$;
    INSERT INTO public.one_vs_one_rooms(id,status,state) VALUES ('${room}','active','{"status":"started","matchFinished":false}');
    INSERT INTO public.one_vs_one_players(id,room_id,user_id,kind,bot_takeover,connected,consecutive_timeout_strikes)
      VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${room}','${alice}','human',true,false,2),
             ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','${room}','${bob}','human',false,true,0);
  `);
  await db.exec(migration);
});
after(async () => db?.close());
beforeEach(async () => db.exec('BEGIN'));
afterEach(async () => db.exec('ROLLBACK'));

test('restores the same bot-controlled seat and is idempotent without touching match state or economy', async () => {
  const first = (await db.query('SELECT public.restore_one_vs_one_human_control($1) AS result', [room])).rows[0].result;
  assert.equal(first.status, 'ok');
  assert.equal(first.restored, true);
  const second = (await db.query('SELECT public.restore_one_vs_one_human_control($1) AS result', [room])).rows[0].result;
  assert.equal(second.restored, false);
  const player = (await db.query('SELECT bot_takeover,connected,consecutive_timeout_strikes FROM public.one_vs_one_players WHERE user_id=$1', [alice])).rows[0];
  assert.deepEqual(player, { bot_takeover: false, connected: true, consecutive_timeout_strikes: 0 });
  const roomState = (await db.query('SELECT status,state,version,currency,entry_fee FROM public.one_vs_one_rooms WHERE id=$1', [room])).rows[0];
  assert.equal(roomState.status, 'active');
  assert.equal(roomState.state.status, 'started');
  assert.equal(roomState.version, 8);
  assert.equal(roomState.currency, 'fun');
  assert.equal(Number(roomState.entry_fee), 500);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.one_vs_one_rooms WHERE status='active'")).rows[0].n, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.one_vs_one_moves WHERE room_id=$1 AND action='takeover_restored'", [room])).rows[0].n, 1);
});

test('rejects a finished room', async () => {
  await db.query("UPDATE public.one_vs_one_rooms SET status='finished' WHERE id=$1", [room]);
  await assert.rejects(db.query('SELECT public.restore_one_vs_one_human_control($1)', [room]), /room is not active/);
});
