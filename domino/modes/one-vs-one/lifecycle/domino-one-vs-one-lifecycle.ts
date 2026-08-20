export type DominoOneVsOneLifecycle =
  | "waiting"
  | "playing"
  | "round_result"
  | "finished"
  | "cancelled";

export function deriveDominoOneVsOneLifecycle(state: any): DominoOneVsOneLifecycle {
  if (state?.status === "cancelled") return "cancelled";
  if (state?.status === "finished" || state?.winningTeamId) return "finished";
  if (state?.roundWinnerPlayerId) return "round_result";
  if (state?.status === "started" || state?.board?.centerTile) return "playing";
  return "waiting";
}

export function isDominoOneVsOneCommandAllowed(state: any): boolean {
  return deriveDominoOneVsOneLifecycle(state) === "playing";
}
