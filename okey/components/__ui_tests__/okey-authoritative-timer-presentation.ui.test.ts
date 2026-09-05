import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

test("turn timer is driven by the authoritative deadline, never the presentation queue", () => {
  const timer = readFileSync("okey/components/OkeyTurnTimerBar.tsx", "utf8");
  const scene = readFileSync("okey/scenes/OkeyGameTableScene.tsx", "utf8");
  const coordinator = readFileSync("okey/hooks/useOkeyTileFlightCoordinator.ts", "utf8");

  expect(timer).toMatch(/deadlineMilliseconds = deadlineAt \? Date\.parse\(deadlineAt\)/);
  expect(timer).toMatch(/serverNowMilliseconds = Date\.now\(\) \+ serverClockOffsetMs/);
  expect(timer).toMatch(/timeLeftMilliseconds = Math\.max\([\s\S]*deadlineMilliseconds - serverNowMilliseconds/);

  expect(scene).toMatch(/const isHumanTurn =[\s\S]*turnView\.phase === "playing"[\s\S]*turnView\.playerId === humanPlayer\.id/);
  expect(scene).toMatch(/turnTimerActive=\{[\s\S]*turnTimerVisible &&[\s\S]*isHumanTurn[\s\S]*\}/);
  expect(scene).toMatch(/turnDeadlineAt=\{turnView\.deadlineAt\}/);
  expect(scene).toMatch(/serverClockOffsetMs=\{serverClockOffsetMs\}/);

  expect(coordinator).toContain("presentationQueueRef");
  expect(scene).not.toMatch(/turnTimerActive=\{[\s\S]{0,160}presentedTurnPlayerId/);
});

test("human timeout warning follows authoritative turn ownership even while opponent presentation is draining", () => {
  const scene = readFileSync("okey/scenes/OkeyGameTableScene.tsx", "utf8");

  expect(scene).not.toContain("isPresentedHumanTurn");
  expect(scene).toMatch(/!isHumanTurn \|\|[\s\S]*turnTimeLeft <= 0[\s\S]*turnTimeLeft > 5/);
  expect(scene).toMatch(/warningKey = `\$\{turnView\.playerId\}:\$\{turnView\.deadlineAt\}`/);
});

test("opponent profile time uses authoritative turn owner instead of delayed presented turn", () => {
  const scene = readFileSync("okey/scenes/OkeyGameTableScene.tsx", "utf8");

  expect(scene).toMatch(/timeLeft:\s*turnView\.playerId === player\.id[\s\S]*Math\.max\(0, Math\.ceil\(turnTimeLeft\)\)/);
  expect(scene).not.toMatch(/timeLeft:\s*presentedTurnPlayerId === player\.id/);
});

test("Okey client adapter exposes no client-owned timeout or bot progression hooks", () => {
  const adapter = readFileSync("okey/adapters/okey-multiplayer-adapter.ts", "utf8");

  expect(adapter).not.toMatch(/\bclaimTimeout\s*\(/);
  expect(adapter).not.toMatch(/\bexecuteBotTurn\s*\(/);
  expect(adapter).not.toMatch(/\bstartNextRound\s*\(/);
});

