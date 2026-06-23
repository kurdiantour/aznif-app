type SeatedPlayer = {
  seat?: string | null;
};

const CLOCKWISE_NEXT_SEAT: Record<string, string> = {
  bottom: "right",
  right: "top",
  top: "left",
  left: "bottom",
};

/**
 * Returns the player occupying the clockwise seat after the active player.
 * Player indexes are intentionally not used: their persisted order is
 * bottom → left → top → right, which runs counter-clockwise on the table.
 */
export function getNextClockwisePlayer<T extends SeatedPlayer>(
  players: T[],
  currentPlayer: T | undefined,
): T | undefined {
  const nextSeat = currentPlayer?.seat
    ? CLOCKWISE_NEXT_SEAT[currentPlayer.seat]
    : undefined;

  return nextSeat
    ? players.find((player) => player.seat === nextSeat)
    : undefined;
}
