import { Image } from 'expo-image';

import type { Side } from '../engine';

const PIECE_IMAGES = {
  black: require('@/assets/cosmetics/dama/classic/black.png'),
  cream: require('@/assets/cosmetics/dama/classic/ivory.png'),
} as const;

type Props = { color: Side; width: number; height: number };

export function DamaPiece({ color, width, height }: Props) {
  return (
    <Image
      accessibilityLabel={color === 'black' ? 'Black piece' : 'Ivory piece'}
      source={PIECE_IMAGES[color]}
      contentFit="fill"
      style={{ width, height }}
    />
  );
}
