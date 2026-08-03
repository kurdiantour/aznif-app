import { Image } from "expo-image";
import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  Text,
  View,
  type GestureResponderHandlers,
} from "react-native";

import type { OkeyTile } from "@/okey/types/okey";
import { getOkeyTileAccessibilityLabel, OKEY_ACCESSIBILITY } from "@/okey/accessibility/okey-accessibility";
import { styles } from "./okeyStyles";

export const TILE_IMAGES = {
  red_1: require("@/assets/images/okey/tiles/red-1.png"),
  red_2: require("@/assets/images/okey/tiles/red-2.png"),
  red_3: require("@/assets/images/okey/tiles/red-3.png"),
  red_4: require("@/assets/images/okey/tiles/red-4.png"),
  red_5: require("@/assets/images/okey/tiles/red-5.png"),
  red_6: require("@/assets/images/okey/tiles/red-6.png"),
  red_7: require("@/assets/images/okey/tiles/red-7.png"),
  red_8: require("@/assets/images/okey/tiles/red-8.png"),
  red_9: require("@/assets/images/okey/tiles/red-9.png"),
  red_10: require("@/assets/images/okey/tiles/red-10.png"),
  red_11: require("@/assets/images/okey/tiles/red-11.png"),
  red_12: require("@/assets/images/okey/tiles/red-12.png"),
  red_13: require("@/assets/images/okey/tiles/red-13.png"),

  blue_1: require("@/assets/images/okey/tiles/blue-1.png"),
  blue_2: require("@/assets/images/okey/tiles/blue-2.png"),
  blue_3: require("@/assets/images/okey/tiles/blue-3.png"),
  blue_4: require("@/assets/images/okey/tiles/blue-4.png"),
  blue_5: require("@/assets/images/okey/tiles/blue-5.png"),
  blue_6: require("@/assets/images/okey/tiles/blue-6.png"),
  blue_7: require("@/assets/images/okey/tiles/blue-7.png"),
  blue_8: require("@/assets/images/okey/tiles/blue-8.png"),
  blue_9: require("@/assets/images/okey/tiles/blue-9.png"),
  blue_10: require("@/assets/images/okey/tiles/blue-10.png"),
  blue_11: require("@/assets/images/okey/tiles/blue-11.png"),
  blue_12: require("@/assets/images/okey/tiles/blue-12.png"),
  blue_13: require("@/assets/images/okey/tiles/blue-13.png"),

  black_1: require("@/assets/images/okey/tiles/black-1.png"),
  black_2: require("@/assets/images/okey/tiles/black-2.png"),
  black_3: require("@/assets/images/okey/tiles/black-3.png"),
  black_4: require("@/assets/images/okey/tiles/black-4.png"),
  black_5: require("@/assets/images/okey/tiles/black-5.png"),
  black_6: require("@/assets/images/okey/tiles/black-6.png"),
  black_7: require("@/assets/images/okey/tiles/black-7.png"),
  black_8: require("@/assets/images/okey/tiles/black-8.png"),
  black_9: require("@/assets/images/okey/tiles/black-9.png"),
  black_10: require("@/assets/images/okey/tiles/black-10.png"),
  black_11: require("@/assets/images/okey/tiles/black-11.png"),
  black_12: require("@/assets/images/okey/tiles/black-12.png"),
  black_13: require("@/assets/images/okey/tiles/black-13.png"),

  yellow_1: require("@/assets/images/okey/tiles/yellow-1.png"),
  yellow_2: require("@/assets/images/okey/tiles/yellow-2.png"),
  yellow_3: require("@/assets/images/okey/tiles/yellow-3.png"),
  yellow_4: require("@/assets/images/okey/tiles/yellow-4.png"),
  yellow_5: require("@/assets/images/okey/tiles/yellow-5.png"),
  yellow_6: require("@/assets/images/okey/tiles/yellow-6.png"),
  yellow_7: require("@/assets/images/okey/tiles/yellow-7.png"),
  yellow_8: require("@/assets/images/okey/tiles/yellow-8.png"),
  yellow_9: require("@/assets/images/okey/tiles/yellow-9.png"),
  yellow_10: require("@/assets/images/okey/tiles/yellow-10.png"),
  yellow_11: require("@/assets/images/okey/tiles/yellow-11.png"),
  yellow_12: require("@/assets/images/okey/tiles/yellow-12.png"),
  yellow_13: require("@/assets/images/okey/tiles/yellow-13.png"),

  fake_joker: require("@/assets/images/okey/tiles/fake-joker.png"),
  back: require("@/assets/images/okey/tiles/back.png"),
} as const;

function getTileImage(tile: OkeyTile) {
  if (tile.isFakeJoker) {
    return TILE_IMAGES.fake_joker;
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
  panHandlers,
  width,
  height,
  accessibilityLabel,
  onAccessibilityMovePrevious,
  onAccessibilityMoveNext,
}: OkeyTileFaceProps) {
  /*
   * 0 یعنی روی اصلی تایل.
   * 1 یعنی پشت تایل.
   */
  const flipProgress = useRef(
    new Animated.Value(flipped ? 1 : 0),
  ).current;

  useEffect(() => {
    const animation = Animated.timing(flipProgress, {
      toValue: flipped ? 1 : 0,
      duration: 900,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });

    animation.start();

    return () => {
      animation.stop();
    };
  }, [flipProgress, flipped]);

  /*
   * تایل در وسط انیمیشن کمی بالا می‌رود
   * و در پایان دوباره سر جای خودش می‌نشیند.
   */
  const tileLift = flipProgress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, -14, 0],
  });

  const tileScale = flipProgress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.07, 1]
  });

  const frontRotation = flipProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  const backRotation = flipProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["180deg", "360deg"],
  });

  /*
   * Opacity کمک می‌کند در Android هنگام چرخش،
   * تصویر طرف دیگر به‌شکل آینه‌ای دیده نشود.
   */
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
      {/* روی اصلی تایل */}
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

        {isWildcard ? (
          <View style={styles.okeyChip}>
            <Text style={styles.okeyChipText}>ئ</Text>
          </View>
        ) : null}
      </Animated.View>

      {/* پشت تایل */}
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

    /*
     * عرض و ارتفاع اختصاصی باید بعد از tileShadowCompact قرار بگیرند.
     * در غیر این صورت compact اندازه تایل‌های روی میز را تغییر می‌دهد.
     */
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
};

export function OkeyTileBack({
  small,
  width,
  height,
}: OkeyTileBackProps) {
  return (
    <Image
      source={TILE_IMAGES.back}
      style={[
        styles.tileBack,
        small ? styles.tileBackSmall : undefined,
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