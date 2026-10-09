
export type DamaPieceColor = 'black' | 'cream';

export type DamaPieceModel = {
  id: string;
  row: number;
  column: number;
  color: DamaPieceColor;
};

// UI mock only — 16 pieces per player.
// Black: rows 1 and 2.
// Cream: rows 5 and 6.
// Rows 0, 3, 4 and 7 remain empty.

export const MOCK_DAMA_PIECES: readonly DamaPieceModel[] =
  Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, column) => {
      if (row !== 1 && row !== 2 && row !== 5 && row !== 6) {
        return null;
      }

      return {
        id: `${row}-${column}`,
        row,
        column,
        color: row < 3 ? 'black' as const : 'cream' as const,
      };
    }).filter(
      (piece): piece is DamaPieceModel => piece !== null,
    ),
  ).flat();
