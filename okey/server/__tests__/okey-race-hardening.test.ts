import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("manual leave is retried server-side and client only closes after authoritative success", () => {
  const edge = read("supabase/functions/okey_match/index.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");
  const adapter = read("okey/adapters/supabase-okey-match-adapter.ts");

  assert.match(reconciler, /maxCommitAttempts = input\.action === "manual-leave" \? 3 : 1/);
  assert.match(reconciler, /input\.action === "manual-leave" && conflict && attempt < maxCommitAttempts/);
  assert.match(edge, /loadManualLeaveBundle/);
  assert.match(adapter, /notAppliedOnError:[\s\S]*manual_leave_retry_exhausted/);
  assert.match(adapter, /await this\.runAuthoritativeMutation\([\s\S]*await leaveOkeyRoom/);
});

test("lifecycle wakeups are one-shot, version-bound, and only chain after a committed transition", () => {
  const handoff = read("supabase/functions/_shared/aznif-game-lifecycle.ts");
  const worker = read("supabase/functions/process_bot_turns/index.ts");
  const reconciler = read("okey/server/okey-server-reconciler.ts");

  assert.match(handoff, /expectedVersion: input\.expectedVersion/);
  assert.doesNotMatch(worker, /result\?\.executed === true/);
  assert.match(worker, /initialVersion: Number\(expected_version\)/);
  const wakeupSource = reconciler.slice(
    reconciler.indexOf("export async function reconcileAuthoritativeServerLifecycleWakeup"),
    reconciler.indexOf("export const reconcileAuthoritativeServerScheduler"),
  );
  assert.doesNotMatch(wakeupSource, /refreshAfterInitialSleep|retryIntervalMs|maxRetryDurationMs|await sleep\(|while\s*\(/);
  assert.equal((wakeupSource.match(/await reconcileAuthoritativeServerTurns\(\{/g) ?? []).length, 1);
  assert.match(wakeupSource, /version !== Number\(options\.initialVersion\)/);
});

