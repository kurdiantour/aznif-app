type KingPlayer = {
  id?: string | null;
  user_id?: string | null;
};

export const NEXT_HAND_OPENING_STATE = {
  openingDouble: null,
  openingTileId: null,
  isOpeningRound: false,
  isFirstRound: false,
} as const;

export function getNextHandKingIndex(
  players: KingPlayer[],
  winnerPlayerId: string | null | undefined,
  fallbackIndex = 0,
) {
  const winnerIndex = players.findIndex((player) => {
    return player.id === winnerPlayerId || player.user_id === winnerPlayerId;
  });

  if (winnerIndex >= 0) return winnerIndex;

  return Math.max(0, Math.min(fallbackIndex, Math.max(players.length - 1, 0)));
}
