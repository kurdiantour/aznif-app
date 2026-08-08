import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/okey/migrations/20260802000100_okey_authoritative_core.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");

test("Okey authoritative migration stays in the dedicated schema", () => {
  assert.match(sql, /create schema if not exists okey/);
  assert.match(sql, /create table (?:if not exists )?okey\.matches/);
  assert.match(sql, /create table (?:if not exists )?okey\.match_private_states/);
  assert.doesNotMatch(sql, /domino|one_vs_one|two_vs_two/);
});

test("private state and command log have no client grants", () => {
  assert.match(sql, /revoke all on table okey\.match_private_states from public, anon, authenticated/);
  assert.match(sql, /revoke all on table okey\.match_commands from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant\s+select[^;]+authenticated/);
});

test("public gateways are Okey-specific and service-role only", () => {
  assert.match(sql, /public\.okey_get_authoritative_bundle/);
  assert.match(sql, /public\.okey_commit_authoritative_command/);
  assert.match(sql, /grant execute on function public\.okey_get_authoritative_bundle\(\s*uuid, uuid, uuid\s*\) to service_role/);
  assert.match(sql, /grant execute on function public\.okey_commit_authoritative_command[^;]+to service_role/);
  assert.doesNotMatch(sql, /grant execute[^;]+to (anon|authenticated)/);
});

test("commit gateway locks and versions every idempotent command", () => {
  assert.match(sql, /for update/);
  assert.match(sql, /match_id = p_match_id and command_id = p_command_id/);
  assert.match(sql, /v_match\.version <> p_expected_version/);
  assert.match(sql, /insert into okey\.match_commands/);
});
