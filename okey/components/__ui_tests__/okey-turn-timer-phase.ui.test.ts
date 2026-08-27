import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

test("Draw timer keeps the current bar geometry and renders a dark/light green fill", () => {
  const timer = readFileSync("okey/components/OkeyTurnTimerBar.tsx", "utf8");
  const styles = readFileSync("okey/components/okeyStyles.ts", "utf8");

  expect(timer).toMatch(/phase\?: "draw" \| "throw"/);
  expect(timer).toMatch(/phase === "draw"[\s\S]*LinearGradient/);
  expect(timer).toContain('colors={["#0b5d2a", "#35d06f", "#168a45"]}');
  expect(styles).toMatch(/turnTimerFillDraw:[^\n]+#168a45[^\n]+#35d06f/);
});

test("the table passes the authoritative Draw/Throw phase to every timer", () => {
  const scene = readFileSync("okey/scenes/OkeyGameTableScene.tsx", "utf8");
  const rack = readFileSync("okey/components/OkeyPlayerRack.tsx", "utf8");
  const opponent = readFileSync("okey/components/OkeyOpponentSeat.tsx", "utf8");

  expect(scene).toMatch(/turnTimerPhase: state\.hasDrawnThisTurn \? "throw"[^\n]+"draw"/);
  expect(scene).toMatch(/turnTimerPhase=\{state\.hasDrawnThisTurn \? "throw" : "draw"\}/);
  expect(rack).toContain("phase={turnTimerPhase}");
  expect(opponent).toContain("phase={turnTimerPhase}");
});
test("Throw phase reuses the existing warning Toast once at five seconds with its own message", () => {
  const scene = readFileSync("okey/scenes/OkeyGameTableScene.tsx", "utf8");
  const rack = readFileSync("okey/components/OkeyPlayerRack.tsx", "utf8");

  expect(scene).toMatch(/turnTimeLeft <= 0[\s\S]*turnTimeLeft > 5/);
  expect(scene).toMatch(/warningKey = `\$\{turnView\.playerId\}:\$\{turnView\.deadlineAt\}`/);
  expect(scene).toMatch(/warningClockDeadlineRef\.current !== turnView\.deadlineAt[\s\S]*warningClockDeadlineRef\.current = turnView\.deadlineAt[\s\S]*return/);
  expect(scene).toMatch(/timeoutWarningTurnRef\.current === warningKey/);
  expect(scene).toContain('"هەلدانی تاشەبەردێک انجام بدە"');
  expect(scene).toMatch(/state\.hasDrawnThisTurn[\s\S]*هەلدانی تاشەبەردێک انجام بدە[\s\S]*: undefined/);
  expect(rack).toMatch(/message = "نۆرەی تۆیە"/);
  expect(rack).toContain("style={rackOnlyStyles.warning}");
  expect(rack).toContain("style={rackOnlyStyles.warningText}");
});
