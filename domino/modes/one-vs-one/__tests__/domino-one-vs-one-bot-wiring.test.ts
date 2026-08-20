import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("worker delegates 1v1 before the unchanged generic 2v2 path", () => {
  const source = readFileSync("supabase/functions/process_bot_turns/index.ts", "utf8");
  const delegation = source.search(/if \(mode === "1v1"\) \{\s+const result = await processDominoOneVsOneBotTurn/);
  const genericHand = source.indexOf("const hand = hands[playerIndex] ?? [];");
  assert.ok(delegation >= 0);
  assert.ok(genericHand > delegation);
  assert.doesNotMatch(source.slice(genericHand), /mode === "1v1"/);
  assert.doesNotMatch(source.slice(genericHand), /bot_draw_tile/);
  assert.doesNotMatch(source.slice(genericHand), /currentTurnDrawCount/);
  assert.match(source, /mode === "2v2"/);
  assert.match(source, /getNextOkeyOrderPlayer/);
});
