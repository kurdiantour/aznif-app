import { shouldShowOkeyFinalTilePresentation } from "../okey-round-presentation";

const idleFinishedGate = {
  phase: "finished" as const,
  finalPresentationComplete: false,
  hasQueuedPresentation: false,
  tileFlightActive: false,
  roundResultVisible: false,
  matchResultVisible: false,
  konkanRevealVisible: false,
};

test("completed round cannot remount final tile while next-round commit is pending", () => {
  expect(shouldShowOkeyFinalTilePresentation(idleFinishedGate)).toBe(true);

  const afterAnimationHoldAndScoreAutoClose = {
    ...idleFinishedGate,
    finalPresentationComplete: true,
    roundResultVisible: false,
  };

  // The authoritative snapshot is intentionally still the previous FINISHED
  // round here. Hiding the score popup must not reopen its final tile.
  expect(
    shouldShowOkeyFinalTilePresentation(afterAnimationHoldAndScoreAutoClose),
  ).toBe(false);

  // A future authoritative FINISHED round carries a new completedRoundId, so
  // core reports finalPresentationComplete=false and the gate opens once.
  expect(shouldShowOkeyFinalTilePresentation(idleFinishedGate)).toBe(true);
});
