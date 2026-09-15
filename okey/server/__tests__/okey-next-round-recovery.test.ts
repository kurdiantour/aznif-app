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

test("snapshot is read-only and never schedules authoritative gameplay lifecycle", () => {
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
    /scheduleAznifGameLifecycle\(/,
  );

  assert.doesNotMatch(
    snapshotBlock,
    /settleFinishedState\(currentState\)/,
  );
});

test("authoritative command awaits lifecycle worker acceptance before replying", () => {
  assert.match(
    matchSource,
    /scheduleLifecycleAlarm:[\s\S]*?await scheduleAznifGameLifecycle\(/,
  );

  assert.doesNotMatch(
    matchSource,
    /edgeRuntime\?\.waitUntil\([\s\S]*scheduleAznifGameLifecycle/,
  );
});

test("bot worker keeps server-owned lifecycle delivery outside snapshot path", () => {
  assert.match(
    workerSource,
    /reconcileAuthoritativeServerLifecycleAlarm\(/,
  );

  assert.match(
    workerSource,
    /scheduleAznifGameLifecycle\(/,
  );

  assert.match(workerSource, /AZNIF_GAME_LIFECYCLE_URL/);
});
