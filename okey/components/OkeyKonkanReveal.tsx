import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { useOkeyResponsiveLayout } from "@/okey/layout/OkeyResponsiveLayoutProvider";
import { isOkeyWildcard } from "@/okey/engine/okey-engine";
import { OkeyTileFace } from "./OkeyTileFace";
import type { OkeyTile } from "@/okey/types/okey";

type Props = {
  visible: boolean;
  runTiles: OkeyTile[];
  completionMeldTiles: OkeyTile[];
  okeyTile: OkeyTile;
  onClose: () => void;
  onEntered?: () => void;
};

type AnimatedTileWrapperProps = {
  children: React.ReactNode;
  visible: boolean;
  delay: number;
};

// Animated wrapper for individual tile landing ("shep shep shep" drop-bounce effect)
function AnimatedTileWrapper({ children, visible, delay }: AnimatedTileWrapperProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-22)).current;
  const scale = useRef(new Animated.Value(0.75)).current;

  useEffect(() => {
    if (visible) {
      opacity.setValue(0);
      translateY.setValue(-22);
      scale.setValue(0.75);

      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 160,
            useNativeDriver: true,
          }),
          Animated.spring(scale, {
            toValue: 1,
            friction: 5.5,
            tension: 55,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: 0,
            duration: 160,
            easing: Easing.out(Easing.back(1.5)), // slight overshoot drop effect
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }
  }, [visible, delay, opacity, translateY, scale]);

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY }, { scale }],
      }}
    >
      {children}
    </Animated.View>
  );
}

export function OkeyKonkanReveal({
  visible,
  runTiles,
  completionMeldTiles,
  okeyTile,
  onClose,
  onEntered,
}: Props) {
  const layout = useOkeyResponsiveLayout();
  
  // Outer layer animations
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(0.7)).current;
  const onEnteredRef = useRef(onEntered);

  useEffect(() => {
    onEnteredRef.current = onEntered;
  }, [onEntered]);

  const isTablet = layout.layoutClass === "tablet";
  const rowGap = 6;
  const rowHorizontalPadding = 32;
  const availableRowWidth = Math.max(0, layout.usableWidth - rowHorizontalPadding);
  const preferredTileWidth = isTablet ? 58 : 40;
  const tileWidth = Math.max(
    22,
    Math.min(
      preferredTileWidth,
      Math.floor((availableRowWidth - rowGap * 9) / 10),
    ),
  );
  const tileHeight = Math.round(tileWidth * (isTablet ? 80 / 58 : 56 / 40));

  useEffect(() => {
    if (visible) {
      // Reset outer values
      overlayOpacity.setValue(0);
      titleOpacity.setValue(0);
      titleScale.setValue(0.7);

      // Start outer entrance animations
      const overlayEntrance = Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      const titleEntrance = Animated.sequence([
        Animated.delay(1680),
        Animated.parallel([
          Animated.timing(titleOpacity, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.spring(titleScale, {
            toValue: 1,
            friction: 6.5,
            tension: 40,
            useNativeDriver: true,
          }),
        ]),
      ]);
      overlayEntrance.start(({ finished }) => {
        if (finished) onEnteredRef.current?.();
      });
      titleEntrance.start();

      // Fade out the entire panel after 4.8 seconds
      const timer = setTimeout(() => {
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 500,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) {
            onClose();
          }
        });
      }, 4800);

      return () => clearTimeout(timer);
    }
  }, [visible, onClose, overlayOpacity, titleOpacity, titleScale]);

  if (!visible) return null;

  const RUN_START_DELAY = 350;
  const TILE_STAGGER = 85; // 85ms spacing between each tile drop
  const MELD_START_DELAY = RUN_START_DELAY + (runTiles.length * TILE_STAGGER) + 220;

  return (
    <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
      <View style={styles.container}>
        {/* Title Badge (now appears after the tile sequence) */}
        <Animated.View
          style={[
            styles.badgeContainer,
            isTablet && styles.badgeContainerTablet,
            { opacity: titleOpacity, transform: [{ scale: titleScale }] },
          ]}
        >
          <Text style={[styles.titleText, isTablet && styles.titleTextTablet]}>
            کۆنکان
          </Text>
        </Animated.View>

        {/* Run Row */}
        <View style={styles.tilesRow}>
          {runTiles.map((tile, index) => (
            <AnimatedTileWrapper
              key={tile.id}
              visible={visible}
              delay={RUN_START_DELAY + index * TILE_STAGGER}
            >
              <View style={{ width: tileWidth, height: tileHeight }}>
                <OkeyTileFace
                  tile={tile}
                  compact
                  width={tileWidth}
                  height={tileHeight}
                  isWildcard={isOkeyWildcard(tile, okeyTile)}
                />
              </View>
            </AnimatedTileWrapper>
          ))}
        </View>

        {/* Completion Row */}
        <View style={styles.meldRow}>
          {completionMeldTiles.map((tile, index) => (
            <AnimatedTileWrapper
              key={tile.id}
              visible={visible}
              delay={MELD_START_DELAY + index * TILE_STAGGER}
            >
              <View style={{ width: tileWidth, height: tileHeight }}>
                <OkeyTileFace
                  tile={tile}
                  compact
                  width={tileWidth}
                  height={tileHeight}
                  isWildcard={isOkeyWildcard(tile, okeyTile)}
                />
              </View>
            </AnimatedTileWrapper>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(2, 6, 23, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1010,
    elevation: 1010,
  },
  container: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingHorizontal: 16,
  },
  badgeContainer: {
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    borderWidth: 1.5,
    borderColor: "rgba(248, 215, 116, 0.45)",
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingVertical: 6,
    marginBottom: 20,
    shadowColor: "#f8d774",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  badgeContainerTablet: {
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 10,
    marginBottom: 32,
  },
  titleText: {
    color: "#f8d774",
    fontSize: 18,
    lineHeight: 26,
    fontFamily: "SpedaBold",
    textAlign: "center",
    textShadowColor: "rgba(248, 215, 116, 0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  titleTextTablet: {
    fontSize: 24,
    lineHeight: 34,
  },
  tilesRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginBottom: 20,
    maxWidth: "100%",
  },
  meldRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
});
