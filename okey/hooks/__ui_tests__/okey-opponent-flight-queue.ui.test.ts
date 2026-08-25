import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

test("opponent Draw always resumes the queued Discard owned by the same player", () => {
  const coordinator = readFileSync(
    "okey/hooks/useOkeyTileFlightCoordinator.ts",
    "utf8",
  );

  expect(coordinator).toContain("presentationQueueRef.current.push({ event, projectionState: null })");
  expect(coordinator).toContain("ownerPlayerId: event.actorPlayerId");
  expect(coordinator).toMatch(
    /if \(!startDiscardFlight\(\{[\s\S]*?ownerPlayerId: event\.actorPlayerId,[\s\S]*?\}\)\) return false;\s*presentationQueueRef\.current\.shift\(\)/,
  );
});

test("opponent presentation consumes ordered action events without snapshot diff guards", () => {
  const coordinator = readFileSync(
    "okey/hooks/useOkeyTileFlightCoordinator.ts",
    "utf8",
  );

  expect(coordinator).toContain("adapter.subscribeActionEvents");
  expect(coordinator).toMatch(
    /left\.version - right\.version \|\| left\.sequence - right\.sequence/,
  );
  expect(coordinator).not.toContain("previousDiscardCountRef");
  expect(coordinator).not.toContain("previousDiscardPileRef");
  expect(coordinator).not.toContain("previousDeckCountRef");
  expect(coordinator).not.toContain("setTimeout(startDiscard, 80)");
  expect(coordinator).not.toMatch(
    /if \(!discardFlight\) \{\s*setHideDiscardTopTile\(false\)/,
  );
});
