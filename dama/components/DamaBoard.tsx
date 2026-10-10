import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BOARD_CELLS, BOARD_IMAGE_SIZE, squareAtBoardPoint } from '../board-layout';
import type { Piece, Square } from '../engine';
import { DamaPiece } from './DamaPiece';

type Props = {
  pieces: readonly Piece[];
  selectedId: string | null;
  targets: readonly Square[];
  flipped?: boolean;
  onSquarePress: (square: Square) => void;
  onSquareDrag: (from: Square, to: Square) => void;
};

export function DamaBoard({ pieces, selectedId, targets, flipped = false, onSquarePress, onSquareDrag }: Props) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const scale = Math.min(layout.width, layout.height) / BOARD_IMAGE_SIZE.width;
  const start = useRef({ x: 0, y: 0 });

  const bySquare = new Map(
    pieces.map((piece) => [`${piece.row}-${piece.column}`, piece]),
  );

  return (
    <View
      accessibilityLabel="Dama board, eight by eight"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setLayout((current) => current.width === width && current.height === height
          ? current
          : { width, height });
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        start.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
      }}
      onResponderRelease={(event) => {
        const point = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
        const to = squareAtBoardPoint(point.x, point.y, layout.width, flipped);
        if (!to) return;
        const dragged = Math.hypot(point.x - start.current.x, point.y - start.current.y) > 12;
        if (dragged) {
          const from = squareAtBoardPoint(start.current.x, start.current.y, layout.width, flipped);
          if (from) onSquareDrag(from, to);
        }
        else onSquarePress(to);
      }}
    >
      {BOARD_CELLS.map((cell) => {
        const actualRow = flipped ? 7 - cell.row : cell.row;
        const actualCol = flipped ? 7 - cell.column : cell.column;
        const piece = bySquare.get(`${actualRow}-${actualCol}`);
        const width = cell.width * scale;
        const height = cell.height * scale;
        const pieceSize = width * 1.0;
        const isTarget = targets.some((target) => target.row === actualRow && target.column === actualCol);
        return (
          <View
            key={`${cell.row}-${cell.column}`}
            pointerEvents="none"
            style={[styles.cell, {
              left: cell.x * scale,
              top: cell.y * scale,
              width,
              height,
            }]}
          >
            {isTarget && <View style={[styles.target, { width: width * 0.38, height: height * 0.38, borderRadius: width * 0.19 }]} />}
            {piece?.id === selectedId && <View style={[styles.selected, { width: width * 0.93, height: height * 0.93, borderRadius: width * 0.47 }]} />}
            {piece && <DamaPiece color={piece.color} width={pieceSize} height={pieceSize} />}
            {piece?.king && <Text style={[styles.king, { fontSize: width * 0.44 }]}>★</Text>}
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
  target: { position: 'absolute', backgroundColor: 'rgba(255,218,89,0.62)', borderWidth: 2, borderColor: '#fff2b1' },
  selected: { position: 'absolute', borderWidth: 3, borderColor: '#ffe16f', backgroundColor: 'rgba(255,220,100,0.2)' },
  king: { position: 'absolute', color: '#ffd66e', textShadowColor: '#311506', textShadowRadius: 3, fontWeight: '900' },
});
