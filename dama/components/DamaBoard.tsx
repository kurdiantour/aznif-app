import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BOARD_CELLS, TABLE_IMAGE_SIZE } from '../board-layout';
import type { DamaPieceModel } from '../mock-position';
import { DamaPiece } from './DamaPiece';

type Props = {
  tableWidth: number;
  tableHeight: number;
  pieces: readonly DamaPieceModel[];
};

export function DamaBoard({ tableWidth, tableHeight, pieces }: Props) {
  const [layout, setLayout] = useState({ width: tableWidth, height: tableHeight });
  const scaleX = layout.width / TABLE_IMAGE_SIZE.width;
  const scaleY = layout.height / TABLE_IMAGE_SIZE.height;

  const bySquare = new Map(
    pieces.map((piece) => [`${piece.row}-${piece.column}`, piece]),
  );

  return (
    <View
      pointerEvents="none"
      accessibilityLabel="Dama board, eight by eight"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setLayout((current) => current.width === width && current.height === height
          ? current
          : { width, height });
      }}
    >
      {BOARD_CELLS.map((cell) => {
        const piece = bySquare.get(`${cell.row}-${cell.column}`);
        const width = cell.width * scaleX;
        const height = cell.height * scaleY;
        const pieceSize = Math.min(width, height) * 0.96;
        return (
          <View
            key={`${cell.row}-${cell.column}`}
            style={[styles.cell, {
              left: cell.x * scaleX,
              top: cell.y * scaleY,
              width,
              height,
            }]}
          >
            {piece && <DamaPiece color={piece.color} width={pieceSize} height={pieceSize} />}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
