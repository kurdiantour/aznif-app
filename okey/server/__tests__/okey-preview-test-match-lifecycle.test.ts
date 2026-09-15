import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Preview Test Match schedules version 0 with the shared authoritative lifecycle", () => {
  const preview = readFileSync("supabase/functions/okey_test_match/index.ts", "utf8");
  const createIndex = preview.indexOf('rpc("okey_create_preview_test_match"');
  const scheduleIndex = preview.indexOf("scheduleAznifGameLifecycle({");

  assert.match(preview, /import \{ scheduleAznifGameLifecycle \} from "\.\.\/_shared\/aznif-game-lifecycle\.ts"/);
  assert.ok(createIndex >= 0);
  assert.ok(scheduleIndex > createIndex);
  assert.match(preview.slice(scheduleIndex), /expectedVersion: 0/);
  assert.match(preview.slice(scheduleIndex), /gameType: "okey"/);
  assert.match(preview, /getOkeyLifecycleRunAt\(state, deadline, Date\.now\(\)\)/);
  assert.match(preview.slice(scheduleIndex), /runAt: lifecycleRunAt/);
  assert.doesNotMatch(preview, /executeOkeyBotTurn|setTimeout|sleep\(/);
});