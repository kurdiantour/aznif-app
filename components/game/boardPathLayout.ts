import { KozelBranch } from '@/types/game';
import { DominoTileDirection } from './DominoTile';

export type BoardPathSlot = {
  x: number;
  y: number;
  direction: DominoTileDirection;
};

const HORIZONTAL_STEP = 86;
const VERTICAL_STEP = 86;
const RETURN_STEP = 56;
const CENTER_CLEARANCE = 44;
const EDGE_CLEARANCE = 42;

function slotsThatFit(available: number, step: number, requested: number) {
  return Math.max(1, Math.min(requested, Math.floor(available / step)));
}

export function getBranchPathSlots(
  branch: KozelBranch,
  count: number,
  boardWidth: number,
  boardHeight: number,
): BoardPathSlot[] {
  if (count <= 0) return [];

  if (branch === 'left' || branch === 'right') {
    const xSign = branch === 'right' ? 1 : -1;
    const ySign = branch === 'right' ? 1 : -1;
    const straight = slotsThatFit(
      Math.max(HORIZONTAL_STEP, boardWidth / 2 - CENTER_CLEARANCE - EDGE_CLEARANCE),
      HORIZONTAL_STEP,
      count,
    );
    const bend = slotsThatFit(
      Math.max(VERTICAL_STEP, boardHeight / 2 - EDGE_CLEARANCE),
      VERTICAL_STEP,
      Math.max(0, count - straight),
    );
    const cornerX = xSign * (CENTER_CLEARANCE + HORIZONTAL_STEP * straight);

    return Array.from({ length: count }, (_, index) => {
      if (index < straight) {
        return {
          x: xSign * (CENTER_CLEARANCE + HORIZONTAL_STEP * (index + 1)),
          y: 0,
          direction: branch,
        };
      }

      const bendIndex = index - straight;
      if (bendIndex < bend) {
        return {
          x: cornerX,
          y: ySign * VERTICAL_STEP * (bendIndex + 1),
          direction: ySign > 0 ? 'down' : 'up',
        };
      }

      const returnIndex = bendIndex - bend;
      return {
        x: cornerX - xSign * RETURN_STEP * (returnIndex + 1),
        y: ySign * VERTICAL_STEP * bend,
        direction: xSign > 0 ? 'left' : 'right',
      };
    });
  }

  const ySign = branch === 'down' ? 1 : -1;
  const xSign = branch === 'up' ? 1 : -1;
  const straight = slotsThatFit(
    Math.max(VERTICAL_STEP, boardHeight / 2 - CENTER_CLEARANCE - EDGE_CLEARANCE),
    VERTICAL_STEP,
    count,
  );
  const cornerY = ySign * (CENTER_CLEARANCE + VERTICAL_STEP * straight);

  return Array.from({ length: count }, (_, index) => {
    if (index < straight) {
      return {
        x: 0,
        y: ySign * (CENTER_CLEARANCE + VERTICAL_STEP * (index + 1)),
        direction: branch,
      };
    }

    const bendIndex = index - straight;
    return {
      x: xSign * RETURN_STEP * (bendIndex + 1),
      y: cornerY,
      direction: xSign > 0 ? 'right' : 'left',
    };
  });
}
