import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("2v2 bot worker delegates play and pass to the mode authoritative reducer", () => {
  const source = readFileSync(
    "supabase/functions/process_bot_turns/index.ts",
    "utf8",
  );
  assert.match(source, /reduceTwoVsTwoPlay\(\{/);
  assert.match(source, /reduceTwoVsTwoBotPass\(\{/);
  assert.match(source, /buildTwoVsTwoCommit\(\{/);
  assert.doesNotMatch(source, /const currentPlayer = players\[playerIndex\];[\s\S]*roundToNearestFive/);
});
