import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { getBoardSize } from '../board-layout';
import type { BoardPerspective } from '../board-layout';
import type { Piece, Square } from '../engine';
import { DamaBoard } from './DamaBoard';
import type { BotStepAnimation } from './DamaBoard';

const TABLE_IMAGE = require('@/assets/cosmetics/dama/classic/table.webp');
const BOARD_IMAGE = require('@/assets/cosmetics/dama/classic/board.webp');

type Props = {
  viewportWidth: number;
  viewportHeight: number;
  pieces: readonly Piece[];
  selectedId: string | null;
  forcedMovePieceIds?: readonly string[];
  capturePieceIds?: readonly string[];
  targets: readonly Square[];
  onSquarePress: (square: Square) => void;
  onSquareDrag: (from: Square, to: Square) => void;
  perspective?: BoardPerspective;
  botStep?: BotStepAnimation | null;
};

export const DamaTable = memo(function DamaTable({ viewportWidth, viewportHeight, pieces, selectedId, forcedMovePieceIds, capturePieceIds, targets, onSquarePress, onSquareDrag, perspective = 'cream', botStep }: Props) {
  const boardSize = getBoardSize(viewportWidth, viewportHeight);

  return (
    <View style={styles.table}>
      <Image source={TABLE_IMAGE} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={styles.boardLayer}>
        <View style={boardSize}>
          <Image source={BOARD_IMAGE} style={StyleSheet.absoluteFill} contentFit="contain" />
          <DamaBoard pieces={pieces} selectedId={selectedId} forcedMovePieceIds={forcedMovePieceIds} capturePieceIds={capturePieceIds} targets={targets} onSquarePress={onSquarePress} onSquareDrag={onSquareDrag} perspective={perspective} botStep={botStep} />
        </View>
      </View>
    </View>
  );
});

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
