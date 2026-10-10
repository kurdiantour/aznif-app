import assert from 'node:assert/strict';
import test from 'node:test';

import { BOARD_CELL_SIZE, BOARD_GRID_OFFSET, BOARD_IMAGE_SIZE, getBoardSize, squareAtBoardPoint } from '../board-layout.ts';

test('every visible cell center maps to its own square at native and scaled sizes', () => {
  for (const size of [BOARD_IMAGE_SIZE.width, 307.5, 700]) {
    const scale = size / BOARD_IMAGE_SIZE.width;
    for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) {
      const x = (BOARD_GRID_OFFSET + (column + 0.5) * BOARD_CELL_SIZE) * scale;
      const y = (BOARD_GRID_OFFSET + (row + 0.5) * BOARD_CELL_SIZE) * scale;
      assert.deepEqual(squareAtBoardPoint(x, y, size), { row, column });
    }
    assert.equal(squareAtBoardPoint(0, 0, size), null);
  }
});

test('displayed board remains square', () => {
  for (const [width, height] of [[390, 844], [844, 390], [1280, 720]]) {
    const size = getBoardSize(width, height);
    assert.equal(size.width, size.height);
  }
});
