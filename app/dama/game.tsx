
import { useWindowDimensions, StyleSheet, View } from 'react-native';

import { DamaTable } from '@/dama/components/DamaTable';
import { DamaPlayerSeat } from '@/dama/components/DamaPlayerSeat';
import { BOARD_RECT, TABLE_IMAGE_SIZE } from '@/dama/board-layout';
import { MOCK_DAMA_PLAYERS } from '@/dama/mock-players';
import { MOCK_DAMA_PIECES } from '@/dama/mock-position';
import { useGameSystemGestureProtection } from '@/hooks/useGameSystemGestureProtection';

export default function DamaGameScreen() {
  useGameSystemGestureProtection();

  const { width, height } = useWindowDimensions();

  const boardLeft =
    (Math.min(...BOARD_RECT.leftX) / TABLE_IMAGE_SIZE.width) * width;

  const boardRight =
    (Math.max(...BOARD_RECT.rightX) / TABLE_IMAGE_SIZE.width) * width;

  const sideSpace = Math.max(
    0,
    Math.min(boardLeft, width - boardRight),
  );

  const seatWidth = Math.min(
    150,
    Math.max(0, sideSpace - 16),
  );

  const avatarSize = Math.max(
    0,
    Math.min(64, height * 0.15, seatWidth * 0.42),
  );

  const boardCenter = (boardLeft + boardRight) / 2;
  const seatOffset = (boardRight - boardLeft) / 2 + sideSpace / 2;
  const leftCenter = boardCenter - seatOffset;
  const rightCenter = boardCenter + seatOffset;

  return (
    <View style={styles.scene}>
      <DamaTable
        viewportWidth={width}
        viewportHeight={height}
        pieces={MOCK_DAMA_PIECES}
      />

      <View
        pointerEvents="none"
        style={[
          styles.seatLayer,
          {
            left: leftCenter - seatWidth / 2,
            width: seatWidth,
          },
        ]}
      >
        <DamaPlayerSeat
          player={MOCK_DAMA_PLAYERS.self}
          capturedPieceColor={MOCK_DAMA_PLAYERS.opponent.pieceColor}
          width={seatWidth}
          avatarSize={avatarSize}
        />
      </View>

      <View
        pointerEvents="none"
        style={[
          styles.seatLayer,
          {
            left: rightCenter - seatWidth / 2,
            width: seatWidth,
          },
        ]}
      >
        <DamaPlayerSeat
          player={MOCK_DAMA_PLAYERS.opponent}
          capturedPieceColor={MOCK_DAMA_PLAYERS.self.pieceColor}
          width={seatWidth}
          avatarSize={avatarSize}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: {
    flex: 1,
    backgroundColor: '#0c0c20',
    overflow: 'hidden',
  },
  seatLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
