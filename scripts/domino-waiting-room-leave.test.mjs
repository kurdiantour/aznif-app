import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const oneVsOneSql = readFileSync(
  "supabase/migrations/20260524000600_one_vs_one_production_hardening.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
const twoVsTwoSql = readFileSync(
  "supabase/migrations/20260811000100_domino_parties.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
const sql = `${oneVsOneSql} ${twoVsTwoSql}`;
const screen = readFileSync("app/domino/matchmaking.tsx", "utf8");

test("waiting-room leave supports Domino 1v1 and 2v2 atomically", () => {
  assert.match(oneVsOneSql, /create or replace function public\.cancel_one_vs_one_matchmaking\(p_room_id uuid default null\)/);
  assert.match(twoVsTwoSql, /create or replace function public\.cancel_two_vs_two_matchmaking\(p_room_id uuid default null\)/);
  assert.match(oneVsOneSql, /from public\.one_vs_one_rooms where id=p_room_id for update/);
  assert.match(twoVsTwoSql, /from public\.two_vs_two_rooms where id=p_room_id for update/);
  assert.match(sql, /exists \(select 1 from public\.one_vs_one_private_states/);
  assert.match(sql, /exists\(select 1 from public\.two_vs_two_private_states/);
});

test("leaver membership is deleted and room capacity is repaired", () => {
  assert.match(sql, /delete from public\.one_vs_one_players where room_id=p_room_id and user_id=v_user_id/);
  assert.match(sql, /delete from public\.two_vs_two_players where room_id=p_room_id and user_id=any\(v_users\)/);
  assert.match(sql, /player_count=greatest\(1,v_remaining_count\)/);
  assert.match(sql, /status=case when v_remaining_count=0 then 'cancelled' else 'waiting' end/);
  assert.doesNotMatch(sql, /delete from public\.two_vs_two_players where room_id=p_room_id;/);
});

test("queue, party and presence are released by the same transaction", () => {
  assert.match(sql, /update public\.one_vs_one_matchmaking_queue/);
  assert.match(sql, /update public\.two_vs_two_matchmaking_queue/);
  assert.match(sql, /party_leader_required/);
  assert.match(sql, /set flow_status='idle'/);
  assert.match(sql, /update public\.user_presence set status='online_available'/);
});

test("Waiting Room removes disconnected and deleted players immediately", () => {
  assert.match(screen, /row\.connected !== false/);
  assert.match(screen, /payload\.eventType === "DELETE" \|\| changed\.connected === false/);
  assert.match(screen, /current\.filter\(\(player\) => player\.id !== String\(changed\.id/);
  assert.match(screen, /supabase\.rpc\("cancel_one_vs_one_matchmaking"/);
  assert.match(screen, /supabase\.rpc\("cancel_two_vs_two_matchmaking"/);
  assert.match(screen, /BackHandler\.addEventListener\("hardwareBackPress"/);
  assert.match(screen, /Failed to clean up Domino waiting room/);
});
const matcherSql = readFileSync(
  "supabase/migrations/20260811000100_domino_parties.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
const funScreen = readFileSync("app/domino/fun.tsx", "utf8");
const aznifScreen = readFileSync("app/domino/aznif.tsx", "utf8");

function findPublicWaitingRoom(rooms, memberships, request) {
  return rooms
    .filter((room) =>
      room.status === "waiting" &&
      room.visibility === "public" &&
      room.currency === request.currency &&
      room.entryFee === request.entryFee &&
      memberships.filter((member) => member.roomId === room.id).length <=
        4 - request.partySize
    )
    .sort((left, right) => left.createdAt - right.createdAt)[0] ?? null;
}

test("Search uses only find_domino_match and never a separate rejoin RPC", () => {
  assert.match(funScreen, /supabase\.rpc\(\s*"find_domino_match"/);
  assert.match(aznifScreen, /supabase\.rpc\(\s*"find_domino_match"/);
  assert.doesNotMatch(funScreen, /rejoin_previous_domino_waiting_room/);
  assert.doesNotMatch(aznifScreen, /rejoin_previous_domino_waiting_room/);
});

test("matcher selects capacity from real membership, not queue or stored player_count", () => {
  assert.match(
    matcherSql,
    /select count\(\*\) from public\.two_vs_two_players member where member\.room_id=r\.id/,
  );
  assert.match(matcherSql, /r\.status='waiting'/);
  assert.match(matcherSql, /not in \('private_room','private_room_10'\)/);
  assert.doesNotMatch(
    matcherSql,
    /where r\.status='waiting' and r\.player_count<=4-v_party_size/,
  );
});

test("2v2 three-player leave then Search rejoins the same public room", () => {
  const rooms = [
    {
      id: "room-old",
      status: "waiting",
      visibility: "public",
      currency: "fun",
      entryFee: 3500,
      createdAt: 1,
    },
  ];
  const memberships = [
    { roomId: "room-old", userId: "player-a" },
    { roomId: "room-old", userId: "player-b" },
    { roomId: "room-old", userId: "player-c" },
  ];

  const afterLeave = memberships.filter(
    (member) => member.userId !== "player-c",
  );
  assert.equal(afterLeave.length, 2);

  const selected = findPublicWaitingRoom(rooms, afterLeave, {
    currency: "fun",
    entryFee: 3500,
    partySize: 1,
  });
  assert.equal(selected?.id, "room-old");

  afterLeave.push({ roomId: selected.id, userId: "player-c" });
  assert.equal(
    afterLeave.filter((member) => member.roomId === "room-old").length,
    3,
  );
});

test("private, full, or economy-incompatible rooms are not selected", () => {
  const rooms = [
    { id: "private", status: "waiting", visibility: "private", currency: "fun", entryFee: 3500, createdAt: 1 },
    { id: "full", status: "waiting", visibility: "public", currency: "fun", entryFee: 3500, createdAt: 2 },
    { id: "wrong-fee", status: "waiting", visibility: "public", currency: "fun", entryFee: 999, createdAt: 3 },
  ];
  const memberships = [0, 1, 2, 3].map((index) => ({
    roomId: "full",
    userId: `full-${index}`,
  }));
  assert.equal(
    findPublicWaitingRoom(rooms, memberships, {
      currency: "fun",
      entryFee: 3500,
      partySize: 1,
    }),
    null,
  );
});
