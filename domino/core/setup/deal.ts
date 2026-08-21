import { MAX_PLAYERS } from "@/domino/core/constants/domino-game";
import type { DominoTileData } from "@/domino/types/domino-game";

export type DealResult = {
  hands: DominoTileData[][];
  boneyard: DominoTileData[];
};

export function dealDominoHands(
  deck: DominoTileData[],
  playerCount = MAX_PLAYERS,
): DealResult {
  let workingDeck = [...deck];

  // 1 vs 1
  const isOneVsOne = playerCount === 2;

  // remove 0-0 in 1v1
  if (isOneVsOne) {
    workingDeck = workingDeck.filter(
      (tile) => !(tile.left === 0 && tile.right === 0),
    );
  }

  // hand size
  const handSize = isOneVsOne ? 9 : 7;

  const hands: DominoTileData[][] = Array.from(
    { length: playerCount },
    () => [],
  );

  for (let round = 0; round < handSize; round += 1) {
    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      const nextTile = workingDeck.shift();

      if (!nextTile) {
        throw new Error("Not enough domino tiles to complete dealing.");
      }

      hands[playerIndex].push(nextTile);
    }
  }

  return {
    hands,
    boneyard: workingDeck,
  };
}
