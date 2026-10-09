
import { View } from 'react-native';

import TableBackground from '@/components/game/TableBackground';
import type { DamaPieceModel } from '../mock-position';
import { DamaBoard } from './DamaBoard';

const TABLE_IMAGE = require('@/assets/cosmetics/dama/classic/table.png');

type Props = {
  viewportWidth: number;
  viewportHeight: number;
  pieces: readonly DamaPieceModel[];
};

export function DamaTable({
  viewportWidth,
  viewportHeight,
  pieces,
}: Props) {
  return (
    <View style={{ flex: 1, width: '100%', height: '100%' }}>
      <TableBackground
        imageSource={TABLE_IMAGE}
        contentPadding={false}
      >
        <DamaBoard
          tableWidth={viewportWidth}
          tableHeight={viewportHeight}
          pieces={pieces}
        />
      </TableBackground>
    </View>
  );
}
