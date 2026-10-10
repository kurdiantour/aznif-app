import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { getBoardSize } from '../board-layout';
import type { Piece, Square } from '../engine';
import { DamaBoard } from './DamaBoard';

const TABLE_IMAGE = require('@/assets/cosmetics/dama/classic/table.webp');
const BOARD_IMAGE = require('@/assets/cosmetics/dama/classic/board.webp');

type Props = {
  viewportWidth: number;
  viewportHeight: number;
  pieces: readonly Piece[];
  selectedId: string | null;
  targets: readonly Square[];
  flipped?: boolean;
  onSquarePress: (square: Square) => void;
  onSquareDrag: (from: Square, to: Square) => void;
};

export function DamaTable({ viewportWidth, viewportHeight, pieces, selectedId, targets, flipped = false, onSquarePress, onSquareDrag }: Props) {
  const boardSize = getBoardSize(viewportWidth, viewportHeight);

  return (
    <View style={styles.table}>
      <Image source={TABLE_IMAGE} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={styles.boardLayer}>
        <View style={boardSize}>
          <Image source={BOARD_IMAGE} style={StyleSheet.absoluteFill} contentFit="contain" />
          <DamaBoard pieces={pieces} selectedId={selectedId} targets={targets} flipped={flipped} onSquarePress={onSquarePress} onSquareDrag={onSquareDrag} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  table: { flex: 1, width: '100%', height: '100%' },
  boardLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
