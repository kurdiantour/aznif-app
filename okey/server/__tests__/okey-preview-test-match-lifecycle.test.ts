import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Preview Test Match hands version 0 to the shared authoritative lifecycle", () => {
  const preview = readFileSync("supabase/functions/okey_test_match/index.ts", "utf8");
  const createIndex = preview.indexOf('rpc("okey_create_preview_test_match"');
  const handoffIndex = preview.indexOf("scheduleAznifGameLifecycle({");

  assert.match(preview, /import \{ scheduleAznifGameLifecycle \} from "\.\.\/_shared\/aznif-game-lifecycle\.ts"/);
  assert.ok(createIndex >= 0);
  assert.ok(handoffIndex > createIndex);
  assert.match(preview.slice(handoffIndex), /expectedVersion: 0/);
  assert.match(preview.slice(handoffIndex), /gameType: "okey"/);
  assert.match(preview, /getOkeyLifecycleWakeupAt\(state, deadline, Date\.now\(\)\)/);
  assert.match(preview.slice(handoffIndex), /runAt: lifecycleRunAt/);
  assert.doesNotMatch(preview, /executeOkeyBotTurn|setTimeout|sleep\(/);
});
