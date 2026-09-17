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
import { getOkeyTileAccessibilityLabel, OKEY_ACCESSIBILITY } from "@/okey/accessibility/okey-accessibility";
import { styles } from "./okeyStyles";
import { useOkeyCosmetics } from "@/okey/hooks/useOkeyCosmetics";
import type { OkeyTileImages } from "@/constants/catalog/tables";

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
  accessibilityLabel?: string;
  onAccessibilityMovePrevious?: () => void;
  onAccessibilityMoveNext?: () => void;
};

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
  accessibilityLabel,
  onAccessibilityMovePrevious,
  onAccessibilityMoveNext,
}: OkeyTileFaceProps) {
  const { setAssets } = useOkeyCosmetics();
  const flipProgress = useRef(
    new Animated.Value(flipped ? 1 : 0),
  ).current;
  const onFlipAnimationActiveChangeRef = useRef(onFlipAnimationActiveChange);

  useEffect(() => {
    onFlipAnimationActiveChangeRef.current = onFlipAnimationActiveChange;
  }, [onFlipAnimationActiveChange]);

  useEffect(() => {
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

  const tileNode = (
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
          source={getTileImage(tile, setAssets.tiles)}
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
          source={setAssets.tiles.back}
          style={styles.tileImage}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
        />
      </Animated.View>
    </Animated.View>
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

  const semanticLabel = accessibilityLabel ?? getOkeyTileAccessibilityLabel(tile, { isWildcard, selected });
  const accessibilityActions = [
    ...(onPress ? [{ name: "activate" as const, label: "هەڵبژاردنی بەرد" }] : []),
    ...(onAccessibilityMovePrevious ? [{ name: "decrement" as const, label: "گواستنەوە بۆ پێشوو" }] : []),
    ...(onAccessibilityMoveNext ? [{ name: "increment" as const, label: "گواستنەوە بۆ دواتر" }] : []),
  ];
  const handleAccessibilityAction = (name: string) => {
    if (name === "activate") onPress?.();
    if (name === "decrement") onAccessibilityMovePrevious?.();
    if (name === "increment") onAccessibilityMoveNext?.();
  };

  if (panHandlers) {
    return (
      <View
        {...panHandlers}
        pointerEvents="auto"
        accessible
        accessibilityRole="button"
        accessibilityLabel={semanticLabel}
        accessibilityHint={OKEY_ACCESSIBILITY.tileHint}
        accessibilityState={{ selected: !!selected, disabled: !onPress }}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={(event) => handleAccessibilityAction(event.nativeEvent.actionName)}
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
      accessible
      accessibilityRole={onPress ? "button" : "image"}
      accessibilityLabel={semanticLabel}
      accessibilityHint={onPress ? OKEY_ACCESSIBILITY.tileHint : undefined}
      accessibilityState={{ selected: !!selected, disabled: !onPress }}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={(event) => handleAccessibilityAction(event.nativeEvent.actionName)}
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
