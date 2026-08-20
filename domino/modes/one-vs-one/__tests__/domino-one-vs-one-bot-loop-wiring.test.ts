import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("1v1 client keeps the established bounded multi-draw bot loop", () => {
  const source = readFileSync("domino/modes/one-vs-one/controllers/use-domino-one-vs-one-bot-controller.ts", "utf8");
  assert.match(source, /for \(let actionCount = 0; actionCount < 5; actionCount \+= 1\)/);
  assert.match(source, /args\.adapter!\.processBotTurn\(\)/);
  assert.match(source, /nextState\.currentTurnPlayerId !== args\.currentTurnPlayerId/);
  assert.match(source, /nextState\.roundWinnerPlayerId/);
  assert.match(source, /nextState\.winningTeamId/);
});
