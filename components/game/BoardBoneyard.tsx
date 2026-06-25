import DominoTile from "@/components/game/DominoTile";
import { DominoTileData } from "@/types/game";
import { Animated, StyleSheet, View } from "react-native";

const HIDDEN_BONEYARD_TILE: DominoTileData = {
  id: "hidden-boneyard-0-0",
  left: 0,
  right: 0,
  imageKey: "0-0",
};

type AnimatedSprite = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Props = {
  count: number;
  boardWidth: number;
  boardHeight: number;
  tileWidth: number;
  tileHeight: number;
  edgePadding: number;
  animatedSprite: AnimatedSprite | null;
  animOpacity: Animated.Value;
  animScale: Animated.Value;
  animTranslateX: Animated.Value;
  animTranslateY: Animated.Value;
};

function renderBoneyardStack(
  count: number,
  boardWidth: number,
  boardHeight: number,
  tileWidth: number,
  tileHeight: number,
  edgePadding: number,
) {
  if (count <= 0 || boardHeight <= 0) return null;

  const availableVerticalSpace = boardHeight - edgePadding * 2;

  const displayHeight = Math.max(18, Math.round(tileHeight * 0.72));
  const displayWidth = Math.max(36, Math.round(displayHeight * 0.75));

  const spacing = Math.max(
    0,
    Math.min(
      8,
      Math.floor(
        (availableVerticalSpace - count * displayHeight) /
          Math.max(count + 1, 1),
      ),
    ),
  );

  const stackHeight = count * displayHeight + Math.max(0, count - 1) * spacing;

  const startTop =
    stackHeight <= availableVerticalSpace
      ? Math.max(
          edgePadding,
          Math.round((boardHeight - stackHeight) / 2),
        )
      : edgePadding;

  const leftOffset = -displayWidth - 12;

  return (
    <View pointerEvents="none" style={styles.boneyardStackWrap}>
      {Array.from({ length: count }).map((_, index) => {
        const top = startTop + index * 24;

        return (
          <View
            key={`boneyard-${index}`}
            style={[
              styles.boneyardTileSlot,
              {
                width: displayWidth,
                height: displayHeight,
                left: leftOffset,
                top,
                zIndex: 10 + index,
              },
            ]}
          >
            <DominoTile
              tile={HIDDEN_BONEYARD_TILE}
              width={displayHeight}
              height={displayWidth}
              rotation={90}
            />
          </View>
        );
      })}
    </View>
  );
}

export default function BoardBoneyard({
  count,
  boardWidth,
  boardHeight,
  tileWidth,
  tileHeight,
  edgePadding,
  animatedSprite,
  animOpacity,
  animScale,
  animTranslateX,
  animTranslateY,
}: Props) {
  return (
    <>
      {renderBoneyardStack(
        count,
        boardWidth,
        boardHeight,
        tileWidth,
        tileHeight,
        edgePadding,
      )}

      {animatedSprite && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.boneyardTileSlot,
            {
              position: "absolute",
              left: animatedSprite.left,
              top: animatedSprite.top,
              width: animatedSprite.width,
              height: animatedSprite.height,
              zIndex: 200,
              transform: [
                { translateX: animTranslateX },
                { translateY: animTranslateY },
                { scale: animScale },
              ],
              opacity: animOpacity,
            },
          ]}
        >
          <DominoTile
            tile={HIDDEN_BONEYARD_TILE}
            width={animatedSprite.height}
            height={animatedSprite.width}
            rotation={90}
          />
        </Animated.View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  boneyardStackWrap: {
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    zIndex: 10,
  },
  boneyardTileSlot: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
});
