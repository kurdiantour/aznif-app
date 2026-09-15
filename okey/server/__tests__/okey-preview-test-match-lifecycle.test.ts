import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("Okey Preview has no backend or lifecycle entry point", () => {
  const preview = readFileSync("app/okey/preview.tsx", "utf8");
  assert.doesNotMatch(preview, /supabase|\.rpc\(|\.invoke\(|\.channel\(|scheduleAznifGameLifecycle|matchId|okey_test_match/i);
  assert.equal(existsSync("supabase/functions/okey_test_match/index.ts"), false);
});
