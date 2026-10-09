
export const TABLE_IMAGE_SIZE = {
  width: 1842,
  height: 854,
} as const;

// Straight 8×8 board on the final Dama table image.
const COLUMN_EDGES = [571, 660, 747, 834, 921, 1008, 1095, 1182, 1270] as const;

const ROW_EDGES = [
  94, 176, 260, 343, 427,
  510, 594, 678, 762,
] as const;

export const BOARD_RECT = {
  rowY: ROW_EDGES,
  columnX: COLUMN_EDGES,
  leftX: Array(8).fill(COLUMN_EDGES[0]) as number[],
  rightX: Array(8).fill(COLUMN_EDGES[8]) as number[],
};

export type DamaCell = {
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

// The 64 cells share these measured boundaries in original image pixels.
export const BOARD_CELLS: readonly DamaCell[] = Array.from({ length: 8 }, (_, row) =>
  Array.from({ length: 8 }, (_, column) => {
    const x = COLUMN_EDGES[column];
    const y = ROW_EDGES[row];
    const width = COLUMN_EDGES[column + 1] - x;
    const height = ROW_EDGES[row + 1] - y;
    return { row, column, x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
  }),
).flat();
