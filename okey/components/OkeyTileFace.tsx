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

export const TILE_IMAGES = {
  red_1: require("@/assets/images/okey/sets/classic/tiles/red-1.webp"),
  red_2: require("@/assets/images/okey/sets/classic/tiles/red-2.webp"),
  red_3: require("@/assets/images/okey/sets/classic/tiles/red-3.webp"),
  red_4: require("@/assets/images/okey/sets/classic/tiles/red-4.webp"),
  red_5: require("@/assets/images/okey/sets/classic/tiles/red-5.webp"),
  red_6: require("@/assets/images/okey/sets/classic/tiles/red-6.webp"),
  red_7: require("@/assets/images/okey/sets/classic/tiles/red-7.webp"),
  red_8: require("@/assets/images/okey/sets/classic/tiles/red-8.webp"),
  red_9: require("@/assets/images/okey/sets/classic/tiles/red-9.webp"),
  red_10: require("@/assets/images/okey/sets/classic/tiles/red-10.webp"),
  red_11: require("@/assets/images/okey/sets/classic/tiles/red-11.webp"),
  red_12: require("@/assets/images/okey/sets/classic/tiles/red-12.webp"),
  red_13: require("@/assets/images/okey/sets/classic/tiles/red-13.webp"),

  blue_1: require("@/assets/images/okey/sets/classic/tiles/blue-1.webp"),
  blue_2: require("@/assets/images/okey/sets/classic/tiles/blue-2.webp"),
  blue_3: require("@/assets/images/okey/sets/classic/tiles/blue-3.webp"),
  blue_4: require("@/assets/images/okey/sets/classic/tiles/blue-4.webp"),
  blue_5: require("@/assets/images/okey/sets/classic/tiles/blue-5.webp"),
  blue_6: require("@/assets/images/okey/sets/classic/tiles/blue-6.webp"),
  blue_7: require("@/assets/images/okey/sets/classic/tiles/blue-7.webp"),
  blue_8: require("@/assets/images/okey/sets/classic/tiles/blue-8.webp"),
  blue_9: require("@/assets/images/okey/sets/classic/tiles/blue-9.webp"),
  blue_10: require("@/assets/images/okey/sets/classic/tiles/blue-10.webp"),
  blue_11: require("@/assets/images/okey/sets/classic/tiles/blue-11.webp"),
  blue_12: require("@/assets/images/okey/sets/classic/tiles/blue-12.webp"),
  blue_13: require("@/assets/images/okey/sets/classic/tiles/blue-13.webp"),

  black_1: require("@/assets/images/okey/sets/classic/tiles/black-1.webp"),
  black_2: require("@/assets/images/okey/sets/classic/tiles/black-2.webp"),
  black_3: require("@/assets/images/okey/sets/classic/tiles/black-3.webp"),
  black_4: require("@/assets/images/okey/sets/classic/tiles/black-4.webp"),
  black_5: require("@/assets/images/okey/sets/classic/tiles/black-5.webp"),
  black_6: require("@/assets/images/okey/sets/classic/tiles/black-6.webp"),
  black_7: require("@/assets/images/okey/sets/classic/tiles/black-7.webp"),
  black_8: require("@/assets/images/okey/sets/classic/tiles/black-8.webp"),
  black_9: require("@/assets/images/okey/sets/classic/tiles/black-9.webp"),
  black_10: require("@/assets/images/okey/sets/classic/tiles/black-10.webp"),
  black_11: require("@/assets/images/okey/sets/classic/tiles/black-11.webp"),
  black_12: require("@/assets/images/okey/sets/classic/tiles/black-12.webp"),
  black_13: require("@/assets/images/okey/sets/classic/tiles/black-13.webp"),

  yellow_1: require("@/assets/images/okey/sets/classic/tiles/yellow-1.webp"),
  yellow_2: require("@/assets/images/okey/sets/classic/tiles/yellow-2.webp"),
  yellow_3: require("@/assets/images/okey/sets/classic/tiles/yellow-3.webp"),
  yellow_4: require("@/assets/images/okey/sets/classic/tiles/yellow-4.webp"),
  yellow_5: require("@/assets/images/okey/sets/classic/tiles/yellow-5.webp"),
  yellow_6: require("@/assets/images/okey/sets/classic/tiles/yellow-6.webp"),
  yellow_7: require("@/assets/images/okey/sets/classic/tiles/yellow-7.webp"),
  yellow_8: require("@/assets/images/okey/sets/classic/tiles/yellow-8.webp"),
  yellow_9: require("@/assets/images/okey/sets/classic/tiles/yellow-9.webp"),
  yellow_10: require("@/assets/images/okey/sets/classic/tiles/yellow-10.webp"),
  yellow_11: require("@/assets/images/okey/sets/classic/tiles/yellow-11.webp"),
  yellow_12: require("@/assets/images/okey/sets/classic/tiles/yellow-12.webp"),
  yellow_13: require("@/assets/images/okey/sets/classic/tiles/yellow-13.webp"),

  fake_joker_1: require("@/assets/images/okey/sets/classic/tiles/fake-joker-1.webp"),
  fake_joker_2: require("@/assets/images/okey/sets/classic/tiles/fake-joker-2.webp"),
  back: require("@/assets/images/okey/sets/classic/tiles/back.webp"),
} as const;

function getTileImage(tile: OkeyTile) {
  if (tile.isFakeJoker) {
    return tile.copy === 2 ? TILE_IMAGES.fake_joker_2 : TILE_IMAGES.fake_joker_1;
  }

  const key =
    `${tile.color}_${tile.value}` as keyof typeof TILE_IMAGES;

  return TILE_IMAGES[key];
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
          source={getTileImage(tile)}
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
          source={TILE_IMAGES.back}
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
  return (
    <Image
      source={TILE_IMAGES.back}
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
