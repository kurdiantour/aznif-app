export type OkeyFinalTilePresentationGate = {
  phase: "waiting" | "playing" | "finished";
  finalPresentationComplete: boolean;
  hasQueuedPresentation: boolean;
  tileFlightActive: boolean;
  roundResultVisible: boolean;
  matchResultVisible: boolean;
  konkanRevealVisible: boolean;
};

export function shouldShowOkeyFinalTilePresentation(
  gate: OkeyFinalTilePresentationGate,
) {
  return gate.phase === "finished" &&
    !gate.finalPresentationComplete &&
    !gate.hasQueuedPresentation &&
    !gate.tileFlightActive &&
    !gate.roundResultVisible &&
    !gate.matchResultVisible &&
    !gate.konkanRevealVisible;
}
