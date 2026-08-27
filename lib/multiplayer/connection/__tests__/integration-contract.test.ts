import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Okey room lifecycle uses shared connection instead of DB heartbeat timer", () => {
  const source = read("okey/multiplayer/okey-room-api.ts");
  assert.match(source, /gameRoomConnection\.joinRoom\("okey", matchId\)/);
  assert.doesNotMatch(source, /setInterval\([\s\S]*heartbeatOkeyRoom/);
  assert.doesNotMatch(source, /heartbeatTimer/);
});

test("Domino private waiting no longer writes its own 15s room heartbeat", () => {
  const source = read("app/domino/matchmaking.tsx");
  assert.doesNotMatch(source, /heartbeat_private_10_aznif_room/);
  assert.match(source, /gameRoomConnection\.joinRoom\(gameType, currentRoomId\)/);
});

test("gateway network detach is separate from gameplay manual leave", () => {
  const source = read("supabase/functions/_game_room_connection_gateway/main.ts");
  assert.match(source, /rpc\("detach_connection"/);
  assert.doesNotMatch(source, /rpc\("manual_leave"/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => \{ void rpc\("finish_disconnect"/);
});

test("corrective migration keeps durable grace cleanup", () => {
  const source = read("supabase/migrations/20260827160000_finalize_game_room_connection_lifecycle.sql");
  assert.match(source, /sweep_expired_connections/);
  assert.match(source, /grace_deadline_at <= clock_timestamp\(\)/);
  assert.match(source, /public\.okey_room_action/);
  assert.match(source, /detach_connection/);
});

