import type { DominoTileKey } from "@/constants/catalog/domino-sets";
import { DominoTileData } from "@/domino/types/domino-game";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { useDominoCosmetics } from "@/domino/hooks/useDominoCosmetics";

type Props = {
  tile: DominoTileData;
  width?: number;
  height?: number;
  rotation?: 0 | 90 | 180 | 270;
};

function getImageKey(left: number, right: number) {
  return (left <= right ? `${left}-${right}` : `${right}-${left}`) as DominoTileKey;
}

export default function DominoTile({
  tile,
  width = 28,
  height = 54,
  rotation = 0,
}: Props) {
  const { setAssets } = useDominoCosmetics();
  const imageKey = getImageKey(tile.left, tile.right);

  const finalRotation = ((rotation % 360) + 360) % 360;

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
          source={setAssets.tiles[imageKey]}
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
    alignItems: "center",
    justifyContent: "center",
  },

  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },

  image: {
    width: "100%",
    height: "100%",
  },
});

