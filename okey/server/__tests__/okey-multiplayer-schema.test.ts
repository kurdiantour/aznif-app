import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const baseSql = readFileSync(
  "supabase/migrations/20260802000100_okey_authoritative_core.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
const sql = readFileSync(
  "supabase/migrations/20260802000200_okey_multiplayer_rooms.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
const roomFunction = readFileSync("supabase/functions/okey_room/index.ts", "utf8");
const matchFunction = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
const leaveSettlementSql = readFileSync(
  "supabase/migrations/20260809000100_okey_manual_leave_forfeit_settlement.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");

test("multiplayer migration remains Okey-only", () => {
  assert.match(sql, /alter table okey\.matches/);
  assert.match(sql, /alter table okey\.match_seats/);
  assert.doesNotMatch(sql, /one_vs_one|two_vs_two|domino/);
});

test("matchmaking serializes seat assignment and caps rooms at four", () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /generate_series\(0, 3\)/);
  assert.match(sql, /count\(\*\)[^;]+< 4/s);
  assert.match(baseSql, /unique \(match_id, player_index\)/);
});

test("four connected seats start only after the server countdown", () => {
  assert.match(sql, /interval '5 seconds'/);
  assert.match(sql, /v_member_count <> 4 or v_connected_count <> 4/);
  assert.match(sql, /countdown_deadline_at > now\(\)/);
  assert.match(sql, /last_seen_at >= v_match\.countdown_deadline_at/);
  assert.match(sql, /v_confirmed_count <> 4/);
  assert.match(sql, /insert into okey\.match_private_states/);
});

test("a stale waiting-room heartbeat disconnects the seat and cancels the countdown", () => {
  assert.match(sql, /if v_match\.status = 'waiting' then update okey\.match_seats set connected = false where match_id = v_match\.id and connected = true and last_seen_at/);
  assert.match(sql, /last_seen_at < now\(\) - interval '150 seconds'/);
  assert.match(sql, /set countdown_deadline_at = null/);
  assert.doesNotMatch(sql, /\bready\b|ready_count/);
});

test("stale heartbeat expiration never mutates a playing match or takeover state", () => {
  const expirationBlock = sql.match(
    /if v_match\.status = 'waiting' then update okey\.match_seats set connected = false[\s\S]*?last_seen_at < now\(\) - interval '150 seconds'; end if;/,
  )?.[0] ?? "";

  assert.notEqual(expirationBlock, "");
  assert.doesNotMatch(expirationBlock, /status in \('waiting', 'playing'\)|status = 'playing'/);
  assert.doesNotMatch(
    expirationBlock,
    /controlledbybot|bot_since|manualleftplayerids|manual.leave|takeover|private_states|public_projection|turn_deadline_at/i,
  );
});

test("released membership is excluded from reconnect and future matchmaking", () => {
  assert.match(sql, /membership_released_at is null/);
  assert.match(sql, /membership_released/);
  assert.doesNotMatch(sql, /state->'manualleftplayerids'/);
  assert.match(matchFunction, /manualLeftPlayerIds/);
  assert.match(matchFunction, /manual_leave_is_final/);
});
test("manual-left seats are excluded from winner money and Fun rewards", () => {
  assert.match(leaveSettlementSql, /state->'manualleftplayerids'/);
  assert.match(leaveSettlementSql, /team_id = p_winner_team_id and not \(v_manual_left_player_ids \? seat\.user_id::text\)/);
  assert.match(leaveSettlementSql, /v_match\.prize_pool \/ 2/);
  assert.match(leaveSettlementSql, /and not \(v_manual_left_player_ids \? v_seat\.user_id::text\) then 35/);
  assert.match(leaveSettlementSql, /and not \(v_manual_left_player_ids \? v_seat\.user_id::text\) then 10/);
});

test("finished match response exposes the persisted reward for the requesting player", () => {
  assert.match(matchFunction, /\.from\("fun_match_rewards"\)/);
  assert.match(matchFunction, /\.eq\("match_id", matchId\)/);
  assert.match(matchFunction, /\.eq\("user_id", authData\.user\.id\)/);
  assert.match(matchFunction, /pointDelta: Number\(rewardRow\.point_delta/);
  assert.match(matchFunction, /gemDelta: Number\(rewardRow\.gem_delta/);
});
test("zero-human settlement closes without prize or refund", () => {
  assert.match(leaveSettlementSql, /no_winner_requires_zero_humans/);
  assert.match(leaveSettlementSql, /'type', 'no_winner'/);
  assert.match(leaveSettlementSql, /'payoutperwinner', 0/);
  assert.match(leaveSettlementSql, /'refundedplayers', 0/);
  assert.match(leaveSettlementSql, /set status = 'finished'/);
});
test("room gateway is service-role only and supports reconnect", () => {
  assert.match(sql, /auth\.role\(\) <> 'service_role'/);
  assert.match(sql, /revoke all on function public\.okey_room_action[^;]+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.okey_room_action[^;]+to service_role/);
  assert.match(sql, /reconnect/);
  assert.match(roomFunction, /action !== "matchmake"\s*&&\s*action !== "active-memberships"/);
});

test("Realtime carries invalidation only, never authoritative state", () => {
  assert.match(roomFunction, /event: "invalidate"/);
  assert.match(matchFunction, /event: "invalidate"/);
  assert.doesNotMatch(roomFunction, /payload:\s*\{[^}]*state/s);
  assert.doesNotMatch(matchFunction, /payload:\s*\{[^}]*state/s);
});

test("charged start failures refresh before using the cancellation refund", () => {
  const chargeStart = roomFunction.indexOf('"okey_charge_entry_fee"');
  const failureFlow = roomFunction.slice(chargeStart);

  assert.ok(chargeStart >= 0);
  assert.match(failureFlow, /try\s*\{[\s\S]*createAuthoritativeOkeyMatch[\s\S]*getNextOkeyMatchTurnDeadline[\s\S]*projectOkeyMatchPublicState[\s\S]*callRoomAction\("start"/);
  assert.match(failureFlow, /callRoomAction\("status"[\s\S]*refreshed\.data\.status === "playing"/);
  assert.match(failureFlow, /chargedByThisRequest\s*&&\s*refreshed\.data\.status === "waiting"/);
  assert.match(failureFlow, /"okey_cancel_match_and_refund"[\s\S]*p_cancel_reason: "match_start_failed"/);
  assert.match(failureFlow, /match_start_failed_refund_failed/);
  assert.doesNotMatch(failureFlow, /"okey_settle_match"/);
});
