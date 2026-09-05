import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const matchSource = readFileSync(
  new URL("../../../supabase/functions/okey_match/index.ts", import.meta.url),
  "utf8",
);
const workerSource = readFileSync(
  new URL("../../../supabase/functions/process_bot_turns/index.ts", import.meta.url),
  "utf8",
);

test("snapshot can server-reconcile an overdue finished round", () => {
  assert.match(
    matchSource,
    /if \(!currentState\.matchFinished\) \{\s*const serverReconcile = await reconcileAuthoritativeServerTurns/,
  );
  assert.doesNotMatch(
    matchSource,
    /!currentState\.matchFinished && currentState\.roundState\.phase === ["']playing["']/,
  );
});

test("authoritative command awaits lifecycle worker acceptance before replying", () => {
  assert.match(
    matchSource,
    /const lifecycleHandoff = handOffOkeyServerLifecycle\([\s\S]*?await lifecycleHandoff;/,
  );
  assert.doesNotMatch(
    matchSource,
    /edgeRuntime\?\.waitUntil\(lifecycleHandoff\)/,
  );
});

test("bot worker awaits continuation handoff instead of nesting waitUntil", () => {
  assert.match(workerSource, /await handOffOkeyBotTurn\(/);
  assert.match(workerSource, /await handOffOkeyServerLifecycle\(/);
  assert.doesNotMatch(workerSource, /edgeRuntime\?\.waitUntil\(handoffPromise\)/);
});

