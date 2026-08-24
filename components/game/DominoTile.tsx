import { DominoTileData } from "@/domino/types/domino-game";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

const dominoImages: Record<string, any> = {
  "0-0": require("@/assets/domino-set/0-0.webp"),
  "0-1": require("@/assets/domino-set/0-1.webp"),
  "0-2": require("@/assets/domino-set/0-2.webp"),
  "0-3": require("@/assets/domino-set/0-3.webp"),
  "0-4": require("@/assets/domino-set/0-4.webp"),
  "0-5": require("@/assets/domino-set/0-5.webp"),
  "0-6": require("@/assets/domino-set/0-6.webp"),

  "1-1": require("@/assets/domino-set/1-1.webp"),
  "1-2": require("@/assets/domino-set/1-2.webp"),
  "1-3": require("@/assets/domino-set/1-3.webp"),
  "1-4": require("@/assets/domino-set/1-4.webp"),
  "1-5": require("@/assets/domino-set/1-5.webp"),
  "1-6": require("@/assets/domino-set/1-6.webp"),

  "2-2": require("@/assets/domino-set/2-2.webp"),
  "2-3": require("@/assets/domino-set/2-3.webp"),
  "2-4": require("@/assets/domino-set/2-4.webp"),
  "2-5": require("@/assets/domino-set/2-5.webp"),
  "2-6": require("@/assets/domino-set/2-6.webp"),

  "3-3": require("@/assets/domino-set/3-3.webp"),
  "3-4": require("@/assets/domino-set/3-4.webp"),
  "3-5": require("@/assets/domino-set/3-5.webp"),
  "3-6": require("@/assets/domino-set/3-6.webp"),

  "4-4": require("@/assets/domino-set/4-4.webp"),
  "4-5": require("@/assets/domino-set/4-5.webp"),
  "4-6": require("@/assets/domino-set/4-6.webp"),

  "5-5": require("@/assets/domino-set/5-5.webp"),
  "5-6": require("@/assets/domino-set/5-6.webp"),

  "6-6": require("@/assets/domino-set/6-6.webp"),
};

type Props = {
  tile: DominoTileData;
  width?: number;
  height?: number;
  rotation?: 0 | 90 | 180 | 270;
};

function getImageKey(left: number, right: number) {
  return left <= right ? `${left}-${right}` : `${right}-${left}`;
}

export default function DominoTile({
  tile,
  width = 28,
  height = 54,
  rotation = 0,
}: Props) {
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

