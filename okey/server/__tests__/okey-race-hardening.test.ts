import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("manual leave is retried server-side and client only closes after authoritative success", () => {
  const edge = read("supabase/functions/okey_match/index.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");

  assert.match(edge, /maxCommitAttempts = action === "manual-leave" \? 3 : 1/);
  assert.match(edge, /if \(action === "manual-leave" && conflict && commitAttempt < maxCommitAttempts\)/);
  assert.match(edge, /loadManualLeaveBundle/);
  assert.match(adapter, /notAppliedOnError:[\s\S]*manual_leave_retry_exhausted/);
  assert.match(adapter, /await this\.runAuthoritativeMutation\([\s\S]*await leaveOkeyRoom/);
});

test("lifecycle workers are version-bound, refresh after sleep, and only chain after a committed transition", () => {
  const handoff = read("supabase/functions/_shared/okey-bot-handoff.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");

  assert.match(handoff, /expected_version: input\.expectedVersion/);
  assert.match(worker, /result\?\.executed === true/);
  assert.match(worker, /initialVersion: Number\(expected_version\)/);
  assert.match(reconciler, /refreshAfterInitialSleep = true/);
  assert.match(reconciler, /currentVersion !== Number\(options\.initialVersion\)/);
});

