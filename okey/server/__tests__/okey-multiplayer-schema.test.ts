import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const normalizeSql = (path: string) =>
  readFileSync(path, "utf8")
    .toLowerCase()
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ");

const baseSql = normalizeSql(
  "supabase/migrations/20260802000100_okey_authoritative_core.sql",
);
const roomSql = normalizeSql(
  "supabase/migrations/20260813000400_okey_membership_release.sql",
);
const settlementSql = normalizeSql(
  "supabase/migrations/20260816180000_domino_okey_takeover_economy_fix.sql",
);
const roomFunction = readFileSync("supabase/functions/okey_room/index.ts", "utf8");
const matchFunction = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
const reconciler = readFileSync("okey/server/okey-turn-engine.ts", "utf8");

test("current multiplayer room authority remains Okey scoped", () => {
  assert.match(roomSql, /okey\.matches/);
  assert.match(roomSql, /okey\.match_seats/);
  assert.match(roomSql, /public\.okey_room_action/);
});

test("matchmaking serializes seat assignment and caps rooms at four", () => {
  assert.match(roomSql, /pg_advisory_xact_lock/);
  assert.match(roomSql, /generate_series\(0, 3\)/);
  assert.match(roomSql, /count\(\*\)[^;]+< 4/s);
  assert.match(baseSql, /unique \(match_id, player_index\)/);
});

test("four connected seats start only after the server countdown", () => {
  assert.match(roomSql, /interval '5 seconds'/);
  assert.match(roomSql, /v_member_count <> 4 or v_connected_count <> 4/);
  assert.match(roomSql, /countdown_deadline_at > now\(\)/);
  assert.match(roomSql, /v_confirmed_count <> 4/);
  assert.match(roomSql, /insert into okey\.match_private_states/);
});

test("a stale waiting-room heartbeat disconnects the seat and cancels the countdown", () => {
  assert.match(roomSql, /v_match\.status = 'waiting'/);
  assert.match(roomSql, /connected = false/);
  assert.match(roomSql, /last_seen_at < now\(\) - interval '150 seconds'/);
  assert.match(roomSql, /countdown_deadline_at = null/);
});

test("stale heartbeat expiration stays limited to waiting-room presence", () => {
  const expirationBlock = roomSql.match(
    /if v_match\.status = 'waiting' then[\s\S]*?last_seen_at < now\(\) - interval '150 seconds'[\s\S]*?end if;/,
  )?.[0] ?? "";

  assert.notEqual(expirationBlock, "");
  assert.doesNotMatch(expirationBlock, /controlledbybot|bot_since|manualleftplayerids|takeover|public_projection|turn_deadline_at/i);
});

test("released membership is excluded from reconnect and future matchmaking", () => {
  assert.match(roomSql, /membership_released_at is null/);
  assert.match(roomSql, /membership_release_reason/);
  assert.match(matchFunction, /manualLeftPlayerIds/);
  assert.match(matchFunction, /manual_leave_is_final/);
});

test("manual-left seats are excluded from winner money and Fun rewards", () => {
  assert.match(settlementSql, /manualleftplayerids/);
  assert.match(settlementSql, /v_manual_left_player_ids/);
  assert.match(settlementSql, /p_winner_team_id/);
  assert.match(settlementSql, /point_delta/);
  assert.match(settlementSql, /gem_delta/);
});

test("finished match response exposes the persisted reward for the requesting player", () => {
  assert.match(matchFunction, /reconcileAuthoritativeHumanCommand\(/);
  assert.doesNotMatch(matchFunction, /settleAuthoritativeOkeyMatchForViewer\(/);
  assert.match(reconciler, /\.from\("fun_match_rewards"\)/);
  assert.match(reconciler, /\.eq\("match_id", input\.matchId\)/);
  assert.match(reconciler, /\.eq\("user_id", input\.actorUserId\)/);
  assert.match(reconciler, /pointDelta: Number\(rewardRow\.point_delta/);
  assert.match(reconciler, /gemDelta: Number\(rewardRow\.gem_delta/);
});

test("zero-human settlement closes without prize or refund", () => {
  assert.match(settlementSql, /no_winner_requires_zero_humans/);
  assert.match(settlementSql, /'type', 'no_winner'/);
  assert.match(settlementSql, /'payoutperwinner', 0/);
  assert.match(settlementSql, /'refundedplayers', 0/);
  assert.match(settlementSql, /status = 'finished'/);
});

test("room gateway is service-role only and supports reconnect", () => {
  assert.match(roomSql, /auth\.role\(\) <> 'service_role'/);
  assert.match(roomSql, /'reconnect'/);
  assert.match(roomFunction, /action !== "matchmake"\s*&&\s*action !== "active-memberships"/);
});

test("Realtime uses room invalidation plus committed match state_update projections", () => {
  assert.match(roomFunction, /event: "invalidate"/);
  assert.match(matchFunction, /event: "state_update"/);
  assert.match(matchFunction, /publicProjection/);
  assert.match(matchFunction, /actionEvents/);
  assert.match(matchFunction, /version/);
});

test("charged start failures refresh before using the cancellation refund", () => {
  const chargeStart = roomFunction.indexOf('"okey_charge_entry_fee"');
  const failureFlow = roomFunction.slice(chargeStart);

  assert.ok(chargeStart >= 0);
  assert.match(failureFlow, /try\s*\{[\s\S]*reconcileAuthoritativeMatchStart[\s\S]*callRoomAction\("start"/);
  assert.match(failureFlow, /callRoomAction\("status"[\s\S]*refreshed\.data\.status === "playing"/);
  assert.match(failureFlow, /chargedByThisRequest\s*&&\s*refreshed\.data\.status === "waiting"/);
  assert.match(failureFlow, /"okey_cancel_match_and_refund"[\s\S]*p_cancel_reason: "match_start_failed"/);
  assert.match(failureFlow, /match_start_failed_refund_failed/);
  assert.doesNotMatch(failureFlow, /"okey_settle_match"/);
});

