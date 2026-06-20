import type { DominoTileData, RoundResult, TeamId } from '@/types/game';

export function buildRoundResult({
  winnerId,
  winnerTeam,
  awardedPoints,
  players,
  hands,
}: {
  winnerId: string;
  winnerTeam?: TeamId;
  awardedPoints: number;
  players: Array<{ id: string; playerIndex: number }>;
  hands: DominoTileData[][];
}): RoundResult {
  const remainingTilesByPlayer: Record<string, DominoTileData[]> = {};
  const remainingPipsByPlayer: Record<string, number> = {};

  players.forEach(({ id, playerIndex }) => {
    const tiles = hands[playerIndex] ?? [];
    remainingTilesByPlayer[id] = tiles.map((tile) => ({ ...tile }));
    remainingPipsByPlayer[id] = tiles.reduce(
      (sum, tile) => sum + tile.left + tile.right,
      0,
    );
  });

  return {
    winnerId,
    winnerTeam,
    awardedPoints,
    remainingTilesByPlayer,
    remainingPipsByPlayer,
  };
}
