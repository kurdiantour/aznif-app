export const BOARD_IMAGE_SIZE = { width: 615, height: 615 } as const;

export type BoardPerspective = 'cream' | 'black';

/** Maps logical engine coordinates to the viewer's 180-degree board perspective. */
export function orientSquare(square: { row: number; column: number }, perspective: BoardPerspective) {
  return perspective === 'black'
    ? { row: 7 - square.row, column: 7 - square.column }
    : { row: square.row, column: square.column };
}

// The 8 x 8 grid is inset inside the transparent edge and wooden frame.
export const BOARD_GRID_OFFSET = 40;
export const BOARD_CELL_SIZE = 67;

export function getBoardSize(viewportWidth: number, viewportHeight: number) {
  const width = Math.min(
    viewportWidth * (viewportWidth > viewportHeight ? 0.58 : 0.9),
    viewportHeight * 0.88,
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

export function squareAtBoardPoint(x: number, y: number, boardSize: number): { row: number; column: number } | null {
  if (boardSize <= 0) return null;
  const scale = boardSize / BOARD_IMAGE_SIZE.width;
  const column = Math.floor((x / scale - BOARD_GRID_OFFSET) / BOARD_CELL_SIZE);
  const row = Math.floor((y / scale - BOARD_GRID_OFFSET) / BOARD_CELL_SIZE);
  return row >= 0 && row < 8 && column >= 0 && column < 8 ? { row, column } : null;
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
