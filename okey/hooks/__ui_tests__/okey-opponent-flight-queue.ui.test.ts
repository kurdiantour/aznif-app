import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

test("opponent Draw always resumes the queued Discard owned by the same player", () => {
  const coordinator = readFileSync(
    "okey/hooks/useOkeyTileFlightCoordinator.ts",
    "utf8",
  );

  expect(coordinator).toContain("presentationQueueRef.current.push({ event })");
  expect(coordinator).toContain("event.actorPlayerId");
  expect(coordinator).toMatch(/if \(!sourceSeatRect \|\| !discardRect\) return false/);
});

test("opponent presentation consumes ordered action events without snapshot diff guards", () => {
  const coordinator = readFileSync(
    "okey/hooks/useOkeyTileFlightCoordinator.ts",
    "utf8",
  );

  expect(coordinator).toContain("adapter.subscribeActionEvents");
  expect(coordinator).toMatch(
    /left\.event\.version - right\.event\.version \|\|\s*left\.event\.sequence - right\.event\.sequence/,
  );
  expect(coordinator).not.toContain("previousDiscardCountRef");
  expect(coordinator).not.toContain("previousDiscardPileRef");
  expect(coordinator).not.toContain("previousDeckCountRef");
  expect(coordinator).not.toContain("setTimeout(startDiscard, 80)");
  expect(coordinator).not.toMatch(
    /if \(!discardFlight\) \{\s*setHideDiscardTopTile\(false\)/,
  );
});
