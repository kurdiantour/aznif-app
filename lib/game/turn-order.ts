type SeatedPlayer = {
  seat?: string | null;
  player_index?: number | null;
};

const OKEY_NEXT_SEAT: Record<string, string> = {
  bottom: "left",
  left: "top",
  top: "right",
  right: "bottom",
};

/**
 * Uses the same authoritative turn order as Okey: player indexes
 * 0 -> 1 -> 2 -> 3 -> 0. Persisted Domino seats follow that order as
 * bottom -> left -> top -> right.
 */
export function getNextOkeyOrderPlayer<T extends SeatedPlayer>(
  players: T[],
  currentPlayer: T | undefined,
): T | undefined {
  if (typeof currentPlayer?.player_index === "number") {
    const nextPlayerIndex = (currentPlayer.player_index + 1) % 4;
    const indexedPlayer = players.find(
      (player) => player.player_index === nextPlayerIndex,
    );
    if (indexedPlayer) return indexedPlayer;
  }

  const nextSeat = currentPlayer?.seat
    ? OKEY_NEXT_SEAT[currentPlayer.seat]
    : undefined;

  return nextSeat
    ? players.find((player) => player.seat === nextSeat)
    : undefined;
}