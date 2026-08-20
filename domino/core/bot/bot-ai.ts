import {
  applyMove,
  getPlayableBranches,
  isValidMove,
} from "@/domino/core/engine/kozel-engine";
import { DominoTileData, KozelBoardState, KozelBranch } from "@/types/game";

const BOT_BRANCH_PRIORITY: KozelBranch[] = ["right", "left", "up", "down"];

type BotMoveDecision = {
  tile: DominoTileData;
  branch: KozelBranch;
  score: number;
};

export function findBestBotMove(
  hand: DominoTileData[],
  board: KozelBoardState,
  spinnerValue: number | null,
  isOpeningRound: boolean,
  openingDouble?: number | null,
) {
  const moves: BotMoveDecision[] = [];

  for (const tile of hand) {
    const playableBranches = getPlayableBranches(
      tile,
      board,
      spinnerValue,
      isOpeningRound,
      openingDouble,
    );

    for (const branch of playableBranches) {
      if (
        !isValidMove(
          tile,
          board,
          branch,
          spinnerValue,
          isOpeningRound,
          openingDouble,
        )
      ) {
        continue;
      }

      const { moveScore } = applyMove(
        board,
        tile,
        branch,
        spinnerValue,
        isOpeningRound,
      );

      moves.push({ tile, branch, score: moveScore });
    }
  }

  if (!moves.length) {
    return null;
  }

  const bestScore = Math.max(...moves.map((move) => move.score));

  const candidateMoves = moves
    .filter((move) => move.score === bestScore)
    .sort((a, b) => {
      const branchIndexA = BOT_BRANCH_PRIORITY.indexOf(a.branch);
      const branchIndexB = BOT_BRANCH_PRIORITY.indexOf(b.branch);

      return branchIndexA - branchIndexB;
    });

  return candidateMoves[0];
}
