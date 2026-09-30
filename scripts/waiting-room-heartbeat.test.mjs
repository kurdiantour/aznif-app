import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const domino = readFileSync("domino/multiplayer/useDominoWaitingRoom.ts", "utf8");
const okeyClient = readFileSync("okey/multiplayer/okey-room-api.ts", "utf8");
const okeyRoom = readFileSync("supabase/functions/okey_room/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260828025845_stabilize_all_waiting_room_heartbeats.sql", "utf8");

test("Domino 1v1 and 2v2 Waiting use an immediate, periodic and foreground heartbeat", () => {
  assert.match(domino, /domino_waiting_room_heartbeat/);
  assert.match(domino, /p_mode: gameMode/);
  assert.match(domino, /void heartbeat\(\);/);
  assert.match(domino, /setInterval\(\(\) => void heartbeat\(\), 60_000\)/);
  assert.match(domino, /AppState\.addEventListener\("change"/);
  assert.doesNotMatch(domino, /gameRoomConnection|GAME_ROOM_WS/);
});

test("Domino Cancel remains authoritative and removes Waiting membership", () => {
  assert.match(domino, /cancel_one_vs_one_matchmaking/);
  assert.match(domino, /cancel_two_vs_two_matchmaking/);
  assert.match(domino, /leaveWaitingRoomRef\.current\(\)/);
});

test("Okey Waiting uses immediate, periodic and foreground heartbeat and authoritative leave", () => {
  assert.match(okeyClient, /void heartbeat\(\);/);
  assert.match(okeyClient, /setInterval\(\(\) => void heartbeat\(\), 60_000\)/);
  assert.match(okeyClient, /AppState\.addEventListener\("change"/);
  assert.match(okeyClient, /action: "leave"/);
  assert.doesNotMatch(okeyClient, /gameRoomConnection|GAME_ROOM_WS/);
});

test("server cleanup removes only stale pre-game memberships and repairs queues and rooms", () => {
  assert.match(migration, /create or replace function public\.expire_stale_waiting_room_members/);
  assert.match(migration, /room\.status = 'waiting'/);
  assert.match(migration, /match\.status = 'waiting'/);
  assert.match(migration, /delete from public\.one_vs_one_players/);
  assert.match(migration, /delete from public\.two_vs_two_players/);
  assert.match(migration, /delete from okey\.match_seats/);
  assert.match(migration, /one_vs_one_matchmaking_queue/);
  assert.match(migration, /two_vs_two_matchmaking_queue/);
  assert.match(migration, /countdown_deadline_at = null/);
  assert.match(migration, /user_presence/);
  assert.match(migration, /expire-stale-waiting-room-members/);
  assert.doesNotMatch(migration, /delete from .* where .*status = 'active'/i);
  assert.doesNotMatch(migration, /delete from .* where .*status = 'playing'/i);
});

test("Okey actions invoke the server-owned stale cleanup", () => {
  assert.match(okeyRoom, /expire_stale_waiting_room_members/);
  assert.match(okeyRoom, /\["matchmake", "status", "heartbeat", "reconnect"\]/);
});