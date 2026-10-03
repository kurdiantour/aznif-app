import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const userA = "00000000-0000-0000-0000-000000000001";
const userB = "00000000-0000-0000-0000-000000000002";
const userC = "00000000-0000-0000-0000-000000000003";
const userD = "00000000-0000-0000-0000-000000000004";
const room1 = "10000000-0000-0000-0000-000000000001";
const room2 = "20000000-0000-0000-0000-000000000002";
const room3 = "30000000-0000-0000-0000-000000000003";
const room4 = "40000000-0000-0000-0000-000000000004";

test("shared Domino countdown, cancellation and authoritative start", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('app.uid', true), '')::uuid
      $$;
      create table public.one_vs_one_rooms (id uuid primary key, status text not null,
        created_at timestamptz default now(), updated_at timestamptz default now(),
        player_count int default 1);
      create table public.two_vs_two_rooms (id uuid primary key, status text not null,
        created_at timestamptz default now(), updated_at timestamptz default now(),
        player_count int default 1);
      create table public.one_vs_one_players (id uuid default gen_random_uuid(), room_id uuid,
        user_id uuid, connected boolean default true, abandoned boolean default false,
        last_seen_at timestamptz default now(), updated_at timestamptz default now());
      create table public.two_vs_two_players (id uuid default gen_random_uuid(), room_id uuid,
        user_id uuid, connected boolean default true, abandoned boolean default false,
        last_seen_at timestamptz default now(), updated_at timestamptz default now());
      create table public.one_vs_one_private_states (room_id uuid primary key);
      create table public.two_vs_two_private_states (room_id uuid primary key);
      create table public.user_presence (user_id uuid primary key, status text,
        last_seen_at timestamptz, updated_at timestamptz);
      create function public.cancel_one_vs_one_matchmaking(p_room_id uuid default null)
      returns jsonb language plpgsql as $$ begin
        delete from public.one_vs_one_players where room_id = p_room_id and user_id = auth.uid();
        return jsonb_build_object('status','cancelled'); end $$;
      create function public.cancel_two_vs_two_matchmaking(p_room_id uuid default null)
      returns jsonb language plpgsql as $$ begin
        delete from public.two_vs_two_players where room_id = p_room_id and user_id = auth.uid();
        return jsonb_build_object('status','cancelled'); end $$;
      create function public.start_one_vs_one_game(p_room_id uuid) returns jsonb
      language plpgsql as $$ begin
        insert into public.one_vs_one_private_states values (p_room_id);
        update public.one_vs_one_rooms set status='active' where id=p_room_id;
        return '{}'::jsonb; end $$;
      create function public.start_two_vs_two_game(p_room_id uuid) returns jsonb
      language plpgsql as $$ begin
        insert into public.two_vs_two_private_states values (p_room_id);
        update public.two_vs_two_rooms set status='active' where id=p_room_id;
        return '{}'::jsonb; end $$;
      create function public.expire_stale_waiting_room_members(integer) returns jsonb
      language sql as $$ select '{}'::jsonb $$;
    `);
    await db.exec(readFileSync("supabase/migrations/20261001162504_domino_waiting_room_lifecycle.sql", "utf8"));
    await db.exec(`set app.uid = '${userA}';
      insert into public.one_vs_one_rooms(id,status) values('${room1}','waiting');
      insert into public.one_vs_one_players(room_id,user_id) values('${room1}','${userA}');`);
    let result = await db.query("select countdown_deadline_at from public.one_vs_one_rooms where id=$1", [room1]);
    assert.equal(result.rows[0].countdown_deadline_at, null);
    await db.exec(`insert into public.one_vs_one_players(room_id,user_id) values('${room1}','${userB}');`);
    result = await db.query("select countdown_deadline_at from public.one_vs_one_rooms where id=$1", [room1]);
    assert.ok(result.rows[0].countdown_deadline_at);
    await assert.rejects(db.query("select public.cancel_one_vs_one_matchmaking(null)"), /countdown_in_progress/);
    await assert.rejects(db.query("insert into public.one_vs_one_private_states values($1)", [room1]), /countdown_not_complete/);
    await db.query("update public.one_vs_one_players set connected=false where room_id=$1 and user_id=$2", [room1, userB]);
    result = await db.query("select countdown_deadline_at from public.one_vs_one_rooms where id=$1", [room1]);
    assert.equal(result.rows[0].countdown_deadline_at, null);
    await db.query("select public.cancel_one_vs_one_matchmaking(null)");
    result = await db.query("select count(*)::int as count from public.one_vs_one_players where room_id=$1 and user_id=$2", [room1, userA]);
    assert.equal(result.rows[0].count, 0);

    await db.exec(`insert into public.two_vs_two_rooms(id,status) values('${room2}','waiting');`);
    for (const user of [userA, userB, userC, userD]) {
      await db.query("insert into public.two_vs_two_players(room_id,user_id) values($1,$2)", [room2, user]);
    }
    result = await db.query("select countdown_deadline_at from public.two_vs_two_rooms where id=$1", [room2]);
    assert.ok(result.rows[0].countdown_deadline_at);
    await db.query("update public.two_vs_two_rooms set status='active' where id=$1", [room2]);
    result = await db.query("select status from public.two_vs_two_rooms where id=$1", [room2]);
    assert.equal(result.rows[0].status, "waiting");
    await db.query("update public.two_vs_two_rooms set countdown_deadline_at=now()-interval '1 second' where id=$1", [room2]);
    result = await db.query("select public.domino_waiting_room_status('2v2',$1) as snapshot", [room2]);
    assert.equal(result.rows[0].snapshot.started, true);
    result = await db.query("select status from public.two_vs_two_rooms where id=$1", [room2]);
    assert.equal(result.rows[0].status, "active");

    await db.exec(`insert into public.two_vs_two_rooms(id,status) values('${room3}','waiting');
      insert into public.two_vs_two_players(room_id,user_id) values
        ('${room3}','${userA}'),('${room3}','${userB}'),('${room3}','${userC}');`);
    await db.query("select public.cancel_two_vs_two_matchmaking(null)");
    result = await db.query("select count(*)::int as count from public.two_vs_two_players where room_id=$1 and user_id=$2", [room3, userA]);
    assert.equal(result.rows[0].count, 0);

    await db.exec(`insert into public.one_vs_one_rooms(id,status) values('${room4}','active');
      insert into public.one_vs_one_players(room_id,user_id) values
        ('${room4}','${userA}'),('${room4}','${userB}');`);
    result = await db.query("select status, countdown_deadline_at from public.one_vs_one_rooms where id=$1", [room4]);
    assert.equal(result.rows[0].status, "waiting");
    assert.ok(result.rows[0].countdown_deadline_at);
    await db.query("update public.one_vs_one_rooms set countdown_deadline_at=now()-interval '1 second' where id=$1", [room4]);
    result = await db.query("select public.domino_waiting_room_status('1v1',$1) as snapshot", [room4]);
    assert.equal(result.rows[0].snapshot.started, true);
    await db.query("insert into public.one_vs_one_private_states(room_id) values($1) on conflict(room_id) do update set room_id=excluded.room_id", [room4]);
  } finally {
    await db.close();
  }
});
