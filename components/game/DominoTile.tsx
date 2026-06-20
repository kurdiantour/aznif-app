import { DominoTileData } from '@/types/game';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

const dominoImages: Record<string, any> = {
  '0-0': require('@/assets/domino-set/0-0.webp'),
  '0-1': require('@/assets/domino-set/0-1.webp'),
  '0-2': require('@/assets/domino-set/0-2.webp'),
  '0-3': require('@/assets/domino-set/0-3.webp'),
  '0-4': require('@/assets/domino-set/0-4.webp'),
  '0-5': require('@/assets/domino-set/0-5.webp'),
  '0-6': require('@/assets/domino-set/0-6.webp'),

  '1-1': require('@/assets/domino-set/1-1.webp'),
  '1-2': require('@/assets/domino-set/1-2.webp'),
  '1-3': require('@/assets/domino-set/1-3.webp'),
  '1-4': require('@/assets/domino-set/1-4.webp'),
  '1-5': require('@/assets/domino-set/1-5.webp'),
  '1-6': require('@/assets/domino-set/1-6.webp'),

  '2-2': require('@/assets/domino-set/2-2.webp'),
  '2-3': require('@/assets/domino-set/2-3.webp'),
  '2-4': require('@/assets/domino-set/2-4.webp'),
  '2-5': require('@/assets/domino-set/2-5.webp'),
  '2-6': require('@/assets/domino-set/2-6.webp'),

  '3-3': require('@/assets/domino-set/3-3.webp'),
  '3-4': require('@/assets/domino-set/3-4.webp'),
  '3-5': require('@/assets/domino-set/3-5.webp'),
  '3-6': require('@/assets/domino-set/3-6.webp'),

  '4-4': require('@/assets/domino-set/4-4.webp'),
  '4-5': require('@/assets/domino-set/4-5.webp'),
  '4-6': require('@/assets/domino-set/4-6.webp'),

  '5-5': require('@/assets/domino-set/5-5.webp'),
  '5-6': require('@/assets/domino-set/5-6.webp'),

  '6-6': require('@/assets/domino-set/6-6.webp'),
};

export type DominoTileDirection = 'right' | 'left' | 'down' | 'up';

type Props = {
  tile: DominoTileData;
  width?: number;
  height?: number;
  rotation?: 0 | 90 | 180 | 270;
  matchedPip?: number | null;
  direction?: DominoTileDirection;
};

function getImageKey(left: number, right: number) {
  return left <= right ? `${left}-${right}` : `${right}-${left}`;
}

function normalizeRotation(rotation: number) {
  return ((rotation % 360) + 360) % 360;
}

function getRotationForDirection(
  tile: DominoTileData,
  direction?: DominoTileDirection,
  fallbackRotation: 0 | 90 | 180 | 270 = 0,
) {
  if (!direction) {
    return fallbackRotation;
  }

  if (tile.left === tile.right) {
    if (direction === 'left' || direction === 'right') return 0;
    return 90;
  }

  const low = Math.min(tile.left, tile.right);
  const high = Math.max(tile.left, tile.right);

  const connectedValue = 'connectedValue' in tile ? (tile as any).connectedValue : tile.left;
  const connectedIsLow = connectedValue === low;
  const connectedIsHigh = connectedValue === high;

  if (!connectedIsLow && !connectedIsHigh) {
    return fallbackRotation;
  }

  if (direction === 'right') {
    return connectedIsLow ? 270 : 90;
  }

  if (direction === 'left') {
    return connectedIsLow ? 90 : 270;
  }

  if (direction === 'down') {
    return connectedIsLow ? 0 : 180;
  }

  if (direction === 'up') {
    return connectedIsLow ? 180 : 0;
  }

  return fallbackRotation;
}

export default function DominoTile({
  tile,
  width = 28,
  height = 54,
  rotation = 0,
  direction,
}: Props) {
  const imageKey = getImageKey(tile.left, tile.right);

  const finalRotation = normalizeRotation(
    getRotationForDirection(tile, direction, rotation),
  );

  const isSideways = finalRotation === 90 || finalRotation === 270;

  return (
    <View
      style={[
        styles.slot,
        {
          width: isSideways ? height : width,
          height: isSideways ? width : height,
        },
      ]}
    >
      <View
        style={[
          styles.wrap,
          {
            width,
            height,
            transform: [{ rotate: `${finalRotation}deg` }],
          },
        ]}
      >
        <Image
          source={dominoImages[imageKey]}
          style={styles.image}
          contentFit="contain"
          transition={0}
          cachePolicy="memory-disk"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  image: {
    width: '100%',
    height: '100%',
  },
});
