import { Image } from "expo-image";
import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  View,
  type GestureResponderHandlers,
} from "react-native";

import type { OkeyTile } from "@/okey/types/okey";
import { styles } from "./okeyStyles";
import { useOkeyCosmetics } from "@/okey/hooks/useOkeyCosmetics";
import type { OkeyTileImages } from "@/constants/catalog/okey-sets";

function getTileImage(tile: OkeyTile, tiles: OkeyTileImages) {
  if (tile.isFakeJoker) {
    return tile.copy === 2 ? tiles.fake_joker_2 : tiles.fake_joker_1;
  }

  const key = `${tile.color}_${tile.value}` as keyof OkeyTileImages;
  return tiles[key];
}

type OkeyTileFaceProps = {
  tile: OkeyTile;
  selected?: boolean;
  compact?: boolean;
  isWildcard?: boolean;
  flipped?: boolean;
  onPress?: () => void;
  onFlipAnimationActiveChange?: (active: boolean) => void;
  panHandlers?: GestureResponderHandlers;
  width?: number;
  height?: number;
};

function FlippingTileImage({ tile, tiles, flipped, onFlipAnimationActiveChange }: {
  tile: OkeyTile;
  tiles: OkeyTileImages;
  flipped: boolean;
  onFlipAnimationActiveChange?: (active: boolean) => void;
}) {
  const flipProgress = useRef(
    new Animated.Value(flipped ? 1 : 0),
  ).current;
  const previousFlippedRef = useRef(flipped);
  const onFlipAnimationActiveChangeRef = useRef(onFlipAnimationActiveChange);

  useEffect(() => {
    onFlipAnimationActiveChangeRef.current = onFlipAnimationActiveChange;
  }, [onFlipAnimationActiveChange]);

  useEffect(() => {
    if (previousFlippedRef.current === flipped) return;
    previousFlippedRef.current = flipped;
    onFlipAnimationActiveChangeRef.current?.(true);
    const animation = Animated.timing(flipProgress, {
      toValue: flipped ? 1 : 0,
      duration: 1050,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });

    animation.start(({ finished }) => {
      if (finished) onFlipAnimationActiveChangeRef.current?.(false);
    });

    return () => {
      animation.stop();
      onFlipAnimationActiveChangeRef.current?.(false);
    };
  }, [flipProgress, flipped]);

  const tileLift = flipProgress.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, -35, -85, -35, 0],
  });

  const tileScale = flipProgress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.07, 1],
  });

  const frontRotation = flipProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  const backRotation = flipProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["180deg", "360deg"],
  });

  const frontOpacity = flipProgress.interpolate({
    inputRange: [0, 0.49, 0.5, 1],
    outputRange: [1, 1, 0, 0],
  });

  const backOpacity = flipProgress.interpolate({
    inputRange: [0, 0.49, 0.5, 1],
    outputRange: [0, 0, 1, 1],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        width: "100%",
        height: "100%",
        transform: [
          {
            translateY: tileLift,
          },
          {
            scale: tileScale,
          },
        ],
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          opacity: frontOpacity,
          backfaceVisibility: "hidden",
          transform: [
            {
              perspective: 700,
            },
            {
              rotateY: frontRotation,
            },
          ],
        }}
      >
        <Image
          pointerEvents="none"
          source={getTileImage(tile, tiles)}
          style={styles.tileImage}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
        />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          opacity: backOpacity,
          backfaceVisibility: "hidden",
          transform: [
            {
              perspective: 700,
            },
            {
              rotateY: backRotation,
            },
          ],
        }}
      >
        <Image
          pointerEvents="none"
          source={tiles.back}
          style={styles.tileImage}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
        />
      </Animated.View>
    </Animated.View>
  );

}

export function OkeyTileFace({
  tile,
  selected,
  compact,
  isWildcard,
  flipped = false,
  onPress,
  onFlipAnimationActiveChange,
  panHandlers,
  width,
  height,
}: OkeyTileFaceProps) {
  const { setAssets } = useOkeyCosmetics();
  const tileNode = isWildcard || flipped ? (
    <FlippingTileImage tile={tile} tiles={setAssets.tiles} flipped={flipped}
      onFlipAnimationActiveChange={onFlipAnimationActiveChange} />
  ) : (
    <Image pointerEvents="none" source={getTileImage(tile, setAssets.tiles)}
      style={styles.tileImage} contentFit="contain" cachePolicy="memory-disk" transition={0} />
  );

  const tileStyle = [
    styles.tileShadow,

    compact ? styles.tileShadowCompact : undefined,
    selected ? styles.selectedTile : undefined,
    width !== undefined && height !== undefined
      ? {
          width,
          height,
        }
      : undefined,
  ];

  if (panHandlers) {
    return (
      <View
        {...panHandlers}
        pointerEvents="auto"
        style={tileStyle}
        collapsable={false}
      >
        {tileNode}
      </View>
    );
  }

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={tileStyle}
    >
      {tileNode}
    </Pressable>
  );
}

type OkeyTileBackProps = {
  small?: boolean;
  width?: number;
  height?: number;
  unstyled?: boolean;
};

export function OkeyTileBack({
  small,
  width,
  height,
  unstyled,
}: OkeyTileBackProps) {
  const { setAssets } = useOkeyCosmetics();

  return (
    <Image
      source={setAssets.tiles.back}
      style={[
        unstyled ? undefined : styles.tileBack,
        !unstyled && small ? styles.tileBackSmall : undefined,
        width !== undefined && height !== undefined
          ? {
              width,
              height,
            }
          : undefined,
      ]}
      contentFit="contain"
      cachePolicy="memory-disk"
      transition={0}
    />
  );
}
