export type KozelBranch = 'up' | 'right' | 'down' | 'left';

export type DominoTileData = {
  id: string;
  left: number;
  right: number;
  imageKey?: string;
};

export type BoardPlacedTile = DominoTileData & {
  branch: KozelBranch;
  order: number;
  connectedValue: number;
  outwardValue: number;
};

export type BoardBranchState = {
  branch: KozelBranch;
  tiles: BoardPlacedTile[];
  openValue: number | null;
  blocked: boolean;
};

export type KozelBoardState = {
  centerTile: DominoTileData | null;
  branches: Record<KozelBranch, BoardBranchState>;
};

const KOZEL_BRANCHES: KozelBranch[] = ['up', 'right', 'down', 'left'];

function normalizeImageKey(a: number, b: number) {
  return a <= b ? `${a}-${b}` : `${b}-${a}`;
}

export function isDouble(tile: DominoTileData) {
  return tile.left === tile.right;
}

export function otherSide(tile: DominoTileData, openValue: number) {
  if (tile.left === openValue) return tile.right;
  if (tile.right === openValue) return tile.left;
  return null;
}

export function createEmptyBoard(): KozelBoardState {
  return {
    centerTile: null,
    branches: {
      up: { branch: 'up', tiles: [], openValue: null, blocked: false },
      right: { branch: 'right', tiles: [], openValue: null, blocked: false },
      down: { branch: 'down', tiles: [], openValue: null, blocked: false },
      left: { branch: 'left', tiles: [], openValue: null, blocked: false },
    },
  };
}

export function cloneBoard(board: KozelBoardState): KozelBoardState {
  return {
    centerTile: board.centerTile ? { ...board.centerTile } : null,
    branches: {
      up: { ...board.branches.up, tiles: board.branches.up.tiles.map((tile) => ({ ...tile })) },
      right: { ...board.branches.right, tiles: board.branches.right.tiles.map((tile) => ({ ...tile })) },
      down: { ...board.branches.down, tiles: board.branches.down.tiles.map((tile) => ({ ...tile })) },
      left: { ...board.branches.left, tiles: board.branches.left.tiles.map((tile) => ({ ...tile })) },
    },
  };
}

export function createPlacedTile(
  tile: DominoTileData,
  branch: KozelBranch,
  connectedValue: number,
  order: number,
): BoardPlacedTile {
  const outwardValue = otherSide(tile, connectedValue);
  const branchIsForward = branch === 'right' || branch === 'down';
  const left = branchIsForward ? connectedValue : outwardValue ?? tile.left;
  const right = branchIsForward ? outwardValue ?? tile.right : connectedValue;

  return {
    ...tile,
    left,
    right,
    imageKey: normalizeImageKey(left, right),
    branch,
    order,
    connectedValue,
    outwardValue: outwardValue ?? connectedValue,
  };
}

export function getBranchOpenValue(branchState: BoardBranchState): number | null {
  if (branchState.tiles.length === 0) return branchState.openValue;

  const lastTile = branchState.tiles[branchState.tiles.length - 1];
  return branchState.branch === 'right' || branchState.branch === 'down'
    ? lastTile.right
    : lastTile.left;
}

export function buildBranchPath(
  tiles: BoardPlacedTile[],
  branch: KozelBranch,
  startingValue: number,
) {
  let currentValue = startingValue;

  return tiles.map((tile, index) => {
    const placed = createPlacedTile(tile, branch, currentValue, index);
    currentValue = branch === 'right' || branch === 'down' ? placed.right : placed.left;
    return placed;
  });
}

export function reanchorBoardForSpinner(
  board: KozelBoardState,
  spinnerBranch: 'left' | 'right',
  spinnerValue: number,
) {
  const nextBoard = cloneBoard(board);
  const spinnerState = nextBoard.branches[spinnerBranch];

  if (spinnerState.tiles.length === 0 || !nextBoard.centerTile) return nextBoard;

  const oppositeBranch = spinnerBranch === 'right' ? 'left' : 'right';
  const spinnerTile = spinnerState.tiles[spinnerState.tiles.length - 1];
  const oldSpinnerSideTiles = spinnerState.tiles.slice(0, -1);
  const oldCenterTile = nextBoard.centerTile;
  const oldOppositeBranchTiles = nextBoard.branches[oppositeBranch].tiles;
  const reversedSpinnerSide = [...oldSpinnerSideTiles].reverse();
  const rebuiltSpinnerChain = buildBranchPath(reversedSpinnerSide, oppositeBranch, spinnerValue);
  let currentOpen = spinnerValue;

  if (rebuiltSpinnerChain.length > 0) {
    currentOpen =
      getBranchOpenValue({
        ...nextBoard.branches[oppositeBranch],
        tiles: rebuiltSpinnerChain,
        branch: oppositeBranch,
      }) ?? spinnerValue;
  }

  const centerPlacedTile = createPlacedTile(oldCenterTile, oppositeBranch, currentOpen, rebuiltSpinnerChain.length);

  currentOpen =
    getBranchOpenValue({
      ...nextBoard.branches[oppositeBranch],
      tiles: [...rebuiltSpinnerChain, centerPlacedTile],
      branch: oppositeBranch,
    }) ?? spinnerValue;

  const rebuiltOppositeBranch = buildBranchPath(oldOppositeBranchTiles, oppositeBranch, currentOpen);
  const newOppositeTiles = [...rebuiltSpinnerChain, centerPlacedTile, ...rebuiltOppositeBranch].map((tile, index) => ({
    ...tile,
    order: index,
  }));

  nextBoard.branches[oppositeBranch].tiles = newOppositeTiles;
  nextBoard.branches[oppositeBranch].openValue =
    newOppositeTiles.length > 0
      ? getBranchOpenValue({ ...nextBoard.branches[oppositeBranch], tiles: newOppositeTiles, branch: oppositeBranch })
      : spinnerValue;
  nextBoard.branches[spinnerBranch].tiles = [];
  nextBoard.branches[spinnerBranch].openValue = spinnerValue;
  nextBoard.centerTile = spinnerTile;

  return nextBoard;
}

export function calculateMoveScore(board: KozelBoardState): number {
  if (!board.centerTile) return 0;

  const center = board.centerTile;
  const leftBranch = board.branches.left;
  const rightBranch = board.branches.right;
  const upBranch = board.branches.up;
  const downBranch = board.branches.down;

  const branchTipScore = (branch: BoardBranchState) => {
    if (branch.openValue === null) return 0;

    if (branch.tiles.length === 0) {
      if (isDouble(center) && (branch.branch === 'up' || branch.branch === 'down')) {
        return branch.openValue * 2;
      }

      return branch.openValue;
    }

    const lastTile = branch.tiles[branch.tiles.length - 1];
    return isDouble(lastTile) ? branch.openValue * 2 : branch.openValue;
  };

  const exposedScores: number[] = [];
  const leftHasTiles = leftBranch.tiles.length > 0;
  const rightHasTiles = rightBranch.tiles.length > 0;

  if (isDouble(center)) {
    if (upBranch.tiles.length > 0 && upBranch.openValue !== null) exposedScores.push(branchTipScore(upBranch));
    if (downBranch.tiles.length > 0 && downBranch.openValue !== null) exposedScores.push(branchTipScore(downBranch));

    const spinnerValue = center.left;

    if (!leftHasTiles && !rightHasTiles) {
      exposedScores.push(spinnerValue * 2);
    } else if (!leftHasTiles && rightHasTiles) {
      exposedScores.push(spinnerValue * 2);
      exposedScores.push(branchTipScore(rightBranch));
    } else if (!rightHasTiles && leftHasTiles) {
      exposedScores.push(spinnerValue * 2);
      exposedScores.push(branchTipScore(leftBranch));
    } else {
      exposedScores.push(branchTipScore(leftBranch));
      exposedScores.push(branchTipScore(rightBranch));
    }
  } else {
    if (upBranch.tiles.length > 0 && upBranch.openValue !== null) exposedScores.push(branchTipScore(upBranch));
    if (downBranch.tiles.length > 0 && downBranch.openValue !== null) exposedScores.push(branchTipScore(downBranch));
    if (leftBranch.openValue !== null) exposedScores.push(branchTipScore(leftBranch));
    if (rightBranch.openValue !== null) exposedScores.push(branchTipScore(rightBranch));
  }

  const total = exposedScores.reduce((sum, value) => sum + value, 0);
  return total > 0 && total % 5 === 0 ? total : 0;
}

export function getPlayableBranches(
  tile: DominoTileData,
  board: KozelBoardState,
  spinnerValue: number | null,
  isOpeningRound: boolean,
  openingDouble?: number | null,
): KozelBranch[] {
  if (!board.centerTile) {
    if (isOpeningRound) {
      if (openingDouble === null || openingDouble === undefined) return [];
      return tile.left === openingDouble && tile.right === openingDouble ? ['right'] : [];
    }

    return ['right'];
  }

  const matchingBranches = KOZEL_BRANCHES.filter((branch) => {
    const openValue = board.branches[branch].openValue;
    if (openValue === null) return false;
    return tile.left === openValue || tile.right === openValue;
  });

  if (!matchingBranches.length) return [];

  if (spinnerValue === null) {
    return matchingBranches.filter((branch) => branch === 'left' || branch === 'right');
  }

  const rightStarted = board.branches.right.tiles.length > 0;
  const leftStarted = board.branches.left.tiles.length > 0;

  return matchingBranches.filter((branch) => {
    if (branch === 'right') return true;
    if (branch === 'left') return rightStarted;
    if (branch === 'up' || branch === 'down') return rightStarted && leftStarted;
    return false;
  });
}

export function canAnyPlayerMove(
  allHands: DominoTileData[][],
  board: KozelBoardState,
  spinnerValue: number | null,
  isOpeningRound: boolean,
  openingDouble?: number | null,
) {
  return allHands.some((hand) =>
    hand.some((tile) => getPlayableBranches(tile, board, spinnerValue, isOpeningRound, openingDouble).length > 0),
  );
}

export function canHandMove(
  hand: DominoTileData[],
  board: KozelBoardState,
  spinnerValue: number | null,
  isOpeningRound: boolean,
  openingDouble?: number | null,
) {
  return hand.some((tile) => getPlayableBranches(tile, board, spinnerValue, isOpeningRound, openingDouble).length > 0);
}

export function applyOpeningTile(tile: DominoTileData): KozelBoardState {
  const board = createEmptyBoard();

  board.centerTile = { ...tile, imageKey: normalizeImageKey(tile.left, tile.right) };
  board.branches.right.openValue = tile.right;
  board.branches.left.openValue = tile.left;

  return board;
}

export function appendTileToBranch(
  board: KozelBoardState,
  tile: DominoTileData,
  branch: KozelBranch,
  spinnerValue: number | null,
): KozelBoardState {
  const nextBoard = cloneBoard(board);
  const branchState = nextBoard.branches[branch];
  const currentOpen = branchState.openValue;

  if (currentOpen === null) return nextBoard;

  const nextOpen = otherSide(tile, currentOpen);
  if (nextOpen === null) return nextBoard;

  branchState.tiles.push(createPlacedTile(tile, branch, currentOpen, branchState.tiles.length));
  branchState.openValue = nextOpen;

  if (spinnerValue === null && isDouble(tile) && (branch === 'left' || branch === 'right')) {
    const placedSpinner = branchState.tiles[branchState.tiles.length - 1];
    return reanchorBoardForSpinner(nextBoard, branch, placedSpinner.left);
  }

  if (spinnerValue !== null && nextBoard.branches.left.tiles.length > 0 && nextBoard.branches.right.tiles.length > 0) {
    if (nextBoard.branches.up.openValue === null) nextBoard.branches.up.openValue = spinnerValue;
    if (nextBoard.branches.down.openValue === null) nextBoard.branches.down.openValue = spinnerValue;
  }

  return nextBoard;
}

export function isValidMove(
  tile: DominoTileData,
  board: KozelBoardState,
  branch: KozelBranch | undefined,
  spinnerValue: number | null,
  isOpeningRound: boolean,
  openingDouble?: number | null,
): boolean {
  const playable = getPlayableBranches(tile, board, spinnerValue, isOpeningRound, openingDouble);

  if (!playable.length) return false;
  if (branch) return playable.includes(branch);
  return true;
}

export type ApplyMoveResult = {
  board: KozelBoardState;
  spinnerValue: number | null;
  moveScore: number;
  reanchored: boolean;
};

export function applyMove(
  board: KozelBoardState,
  tile: DominoTileData,
  branch: KozelBranch | undefined,
  spinnerValue: number | null,
  isOpeningRound: boolean,
): ApplyMoveResult {
  const isOpeningMove = !board.centerTile;
  const nextSpinnerValue = spinnerValue === null && isDouble(tile) ? tile.left : spinnerValue;
  const appliedBranch = branch ?? (isOpeningMove ? 'right' : undefined);
  const nextBoard = isOpeningMove ? applyOpeningTile(tile) : appendTileToBranch(board, tile, appliedBranch as KozelBranch, spinnerValue);
  const moveScore = calculateMoveScore(nextBoard);
  const reanchored = spinnerValue === null && isDouble(tile) && (appliedBranch === 'left' || appliedBranch === 'right');

  return { board: nextBoard, spinnerValue: nextSpinnerValue, moveScore, reanchored };
}
