export type ServerTile = {
  id?: string;
  left?: number;
  right?: number;
  [key: string]: unknown;
};

export function isSameTile(
  a: ServerTile | null | undefined,
  b: ServerTile | null | undefined,
) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  return (
    (Number(a.left) === Number(b.left) &&
      Number(a.right) === Number(b.right)) ||
    (Number(a.left) === Number(b.right) && Number(a.right) === Number(b.left))
  );
}

export function pipTotal(hand: ServerTile[]) {
  return hand.reduce(
    (sum, tile) => sum + Number(tile.left ?? 0) + Number(tile.right ?? 0),
    0,
  );
}

export function roundToNearestFive(value: number) {
  return Math.round(value / 5) * 5;
}

export function handCounts(hands: ServerTile[][]) {
  return hands.map((hand) => hand.length);
}

export function isBoardEmpty(board: any) {
  if (!board) return true;
  return (
    !board.centerTile &&
    !Object.values(board.branches ?? {}).some(
      (branch: any) => Array.isArray(branch?.tiles) && branch.tiles.length > 0,
    )
  );
}
