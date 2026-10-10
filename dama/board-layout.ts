export const BOARD_IMAGE_SIZE = { width: 615, height: 615 } as const;

// The 8 x 8 grid is inset inside the transparent edge and wooden frame.
export const BOARD_GRID_OFFSET = 40;
export const BOARD_CELL_SIZE = 67;

export function getBoardSize(viewportWidth: number, viewportHeight: number) {
  const width = Math.min(
    viewportWidth * 0.98,
    viewportHeight * 0.98,
  );
  return { width, height: width };
}

export type DamaCell = {
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function squareAtBoardPoint(
  x: number,
  y: number,
  boardSize: number,
  flipped = false,
): { row: number; column: number } | null {
  if (boardSize <= 0) return null;
  const scale = boardSize / BOARD_IMAGE_SIZE.width;
  let column = Math.floor((x / scale - BOARD_GRID_OFFSET) / BOARD_CELL_SIZE);
  let row = Math.floor((y / scale - BOARD_GRID_OFFSET) / BOARD_CELL_SIZE);
  if (row < 0 || row >= 8 || column < 0 || column >= 8) return null;
  if (flipped) {
    row = 7 - row;
    column = 7 - column;
  }
  return { row, column };
}

export const BOARD_CELLS: readonly DamaCell[] = Array.from({ length: 8 }, (_, row) =>
  Array.from({ length: 8 }, (_, column) => ({
    row,
    column,
    x: BOARD_GRID_OFFSET + column * BOARD_CELL_SIZE,
    y: BOARD_GRID_OFFSET + row * BOARD_CELL_SIZE,
    width: BOARD_CELL_SIZE,
    height: BOARD_CELL_SIZE,
  })),
).flat();
