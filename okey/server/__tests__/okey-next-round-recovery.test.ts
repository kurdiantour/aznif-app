import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import test from "node:test";

const matchSource = readFileSync(
  new URL("../../../supabase/functions/okey_match/index.ts", import.meta.url),
  "utf8",
);

const workerSource = readFileSync(
  new URL(
    "../../../supabase/functions/process_bot_turns/index.ts",
    import.meta.url,
  ),
  "utf8",
);

test("snapshot is read-only and never wakes authoritative gameplay lifecycle", () => {
  const snapshotBlock =
    matchSource.match(
      /if \(isSnapshot\) \{[\s\S]*?\n  \}\n\n  \/\*\n   \* A duplicate command/,
    )?.[0] ?? "";

  assert.doesNotMatch(
    snapshotBlock,
    /reconcileAuthoritativeServerTurns\(/,
  );

  assert.doesNotMatch(
    snapshotBlock,
    /handOffOkeyServerLifecycle\(/,
  );

  assert.doesNotMatch(
    snapshotBlock,
    /settleFinishedState\(currentState\)/,
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

test("bot worker keeps server-owned lifecycle delivery outside snapshot path", () => {
  assert.match(
    workerSource,
    /await executeOkeyBotTurn\(/,
  );

  assert.match(
    workerSource,
    /handOffOkeyServerLifecycle\(/,
  );

  assert.match(
    workerSource,
    /reconcileAuthoritativeServerLifecycleWakeup\(/,
  );
});