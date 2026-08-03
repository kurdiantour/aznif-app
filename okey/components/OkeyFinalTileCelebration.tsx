import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { isOkeyWildcard } from "@/okey/engine/okey-engine";
import type { OkeyTile } from "@/okey/types/okey";
import { OkeyTileBack, OkeyTileFace } from "./OkeyTileFace";

type ScreenRect = { x: number; y: number; width: number; height: number };

type Props = {
  tile: OkeyTile | null;
  okeyTile: OkeyTile;
  sourceRect: ScreenRect | null;
};

const SPARKS = Array.from({ length: 12 }, (_, index) => ({
  angle: `${index * 30}deg`,
  color: index % 3 === 0 ? "#fff5bd" : index % 2 === 0 ? "#f8d774" : "#f4a340",
  distance: 92 + (index % 3) * 18,
}));

export function OkeyFinalTileCelebration({ tile, okeyTile, sourceRect }: Props) {
  const entrance = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const tileWidth = Math.max(58, (sourceRect?.width ?? 38) * 1.6);
  const tileHeight = Math.max(82, (sourceRect?.height ?? 54) * 1.6);
  const centerX = sourceRect ? sourceRect.x + sourceRect.width / 2 - tileWidth / 2 : screenWidth / 2 - tileWidth / 2;
  const centerY = sourceRect ? sourceRect.y + sourceRect.height / 2 - tileHeight / 2 : screenHeight / 2 - tileHeight / 2 - 28;
  const copyWidth = Math.min(230, screenWidth - 24);
  const copyLeft = Math.max(12, Math.min(screenWidth - copyWidth - 12, centerX + tileWidth / 2 - copyWidth / 2));

  useEffect(() => {
    entrance.setValue(0);
    pulse.setValue(0);
    const reveal = Animated.timing(entrance, {
      toValue: 1,
      duration: 2200,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    reveal.start(({ finished }) => {
      if (finished) breathing.start();
    });
    return () => {
      reveal.stop();
      breathing.stop();
    };
  }, [entrance, pulse]);

  const pulseScale = Animated.add(1, Animated.multiply(pulse, 0.045));

  return (
    <View pointerEvents="auto" style={styles.overlay}>
      <Animated.View
        style={[
          styles.flash,
          { left: centerX + tileWidth / 2 - 55, top: centerY + tileHeight / 2 - 55,
            opacity: entrance.interpolate({ inputRange: [0.35, 0.72, 1], outputRange: [0, 0.72, 0.08] }),
            transform: [{ scale: entrance.interpolate({ inputRange: [0.35, 1], outputRange: [0.15, 5.5] }) }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.spotlight,
          { left: centerX + tileWidth / 2 - 125, top: Math.max(-40, centerY - 115),
            opacity: entrance.interpolate({ inputRange: [0, 0.28, 1], outputRange: [0, 0.45, 0.72] }),
            transform: [{ scaleX: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }],
          },
        ]}
      />
      <View style={[styles.stage, { width: tileWidth, height: tileHeight, left: centerX, top: centerY }]}>
        <Animated.View
          style={[
            styles.cinematicRing,
            styles.outerRing,
            {
              opacity: entrance.interpolate({ inputRange: [0.3, 0.68, 1], outputRange: [0, 0.85, 0.5] }),
              transform: [
                { rotate: entrance.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "120deg"] }) },
                { scale: entrance.interpolate({ inputRange: [0.25, 0.75, 1], outputRange: [0.2, 1.12, 1] }) },
              ],
            },
          ]}
        >
          <View style={[styles.ringGem, styles.ringGemTop]} />
          <View style={[styles.ringGem, styles.ringGemBottom]} />
          <View style={[styles.ringGem, styles.ringGemLeft]} />
          <View style={[styles.ringGem, styles.ringGemRight]} />
        </Animated.View>
        <Animated.View
          style={[
            styles.cinematicRing,
            styles.innerRing,
            {
              opacity: entrance.interpolate({ inputRange: [0.38, 0.72, 1], outputRange: [0, 1, 0.65] }),
              transform: [
                { rotate: entrance.interpolate({ inputRange: [0, 1], outputRange: ["100deg", "-80deg"] }) },
                { scale: entrance.interpolate({ inputRange: [0.3, 0.72, 1], outputRange: [0.1, 1.08, 1] }) },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.halo,
            {
              opacity: entrance.interpolate({ inputRange: [0.45, 0.72, 1], outputRange: [0, 0.95, 0.6] }),
              transform: [{ scale: Animated.multiply(entrance.interpolate({ inputRange: [0.45, 1], outputRange: [0.25, 1] }), Animated.add(1, Animated.multiply(pulse, 0.08))) }],
            },
          ]}
        />
        {SPARKS.map((spark, index) => (
          <Animated.View
            key={spark.angle}
            style={[
              styles.sparkOrbit,
              {
                opacity: entrance.interpolate({ inputRange: [0.45, 0.62, 1], outputRange: [0, 1, 0] }),
                transform: [
                  { rotate: spark.angle },
                  { scale: entrance.interpolate({ inputRange: [0.48, 0.7, 1], outputRange: [0, 1, 0.75] }) },
                ],
              },
            ]}
          >
            <View style={[styles.spark, { height: index % 2 === 0 ? 14 : 8, backgroundColor: spark.color, transform: [{ translateY: -spark.distance }] }]} />
          </Animated.View>
        ))}
        <Animated.View
          style={{
            width: tileWidth,
            height: tileHeight,
            opacity: entrance.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0.2, 1, 1] }),
            transform: [
              { translateY: entrance.interpolate({ inputRange: [0, 0.58, 0.78, 1], outputRange: [0, -18, 5, 0] }) },
              { rotate: entrance.interpolate({ inputRange: [0, 0.72, 1], outputRange: ["-18deg", "390deg", "360deg"] }) },
              { rotateY: entrance.interpolate({ inputRange: [0, 0.48, 1], outputRange: ["0deg", "180deg", "360deg"] }) },
              { scale: Animated.multiply(entrance.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.72, 1.32, 1] }), pulseScale) },
            ],
          }}
        >
          {tile ? <OkeyTileFace tile={tile} width={tileWidth} height={tileHeight} isWildcard={isOkeyWildcard(tile, okeyTile)} /> : <OkeyTileBack />}
        </Animated.View>
      </View>
      <Animated.View
        style={[
          styles.copy,
          { left: copyLeft, width: copyWidth,
            opacity: entrance.interpolate({ inputRange: [0.66, 0.88, 1], outputRange: [0, 0.35, 1] }),
            transform: [{ translateY: entrance.interpolate({ inputRange: [0.66, 1], outputRange: [24, 0] }) }],
          },
        ]}
      >
        <View style={styles.winnerPill}><Text style={styles.winnerPillText}>بەردی کۆتایی</Text></View>
        <Text style={styles.title}>یارییەکە تەواو بوو!</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,6,23,0.84)",
    overflow: "hidden",
  },
  stage: { position: "absolute", alignItems: "center", justifyContent: "center" },
  spotlight: {
    position: "absolute",
    width: 250,
    height: "72%",
    backgroundColor: "rgba(248,215,116,0.12)",
    borderBottomLeftRadius: 125,
    borderBottomRightRadius: 125,
    transform: [{ perspective: 600 }, { rotateX: "28deg" }],
  },
  cinematicRing: { position: "absolute", borderStyle: "dashed", borderColor: "rgba(255,226,129,0.85)" },
  outerRing: { width: 190, height: 190, borderRadius: 95, borderWidth: 2 },
  innerRing: { width: 154, height: 154, borderRadius: 77, borderWidth: 1, borderColor: "rgba(255,246,202,0.62)" },
  ringGem: { position: "absolute", width: 8, height: 8, borderRadius: 2, backgroundColor: "#fff0a8", transform: [{ rotate: "45deg" }], shadowColor: "#ffe06d", shadowOpacity: 1, shadowRadius: 7, elevation: 10 },
  ringGemTop: { top: -5, left: 89 },
  ringGemBottom: { bottom: -5, left: 89 },
  ringGemLeft: { left: -5, top: 89 },
  ringGemRight: { right: -5, top: 89 },
  flash: { position: "absolute", width: 110, height: 110, borderRadius: 55, backgroundColor: "#fff1a8" },
  halo: {
    position: "absolute",
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: "rgba(248,215,116,0.22)",
    borderWidth: 2,
    borderColor: "rgba(255,239,164,0.9)",
    shadowColor: "#ffd965",
    shadowOpacity: 0.95,
    shadowRadius: 24,
    elevation: 18,
  },
  sparkOrbit: { position: "absolute", width: 4, height: 4, alignItems: "center" },
  spark: { width: 4, borderRadius: 3, shadowColor: "#ffe994", shadowOpacity: 1, shadowRadius: 5, elevation: 12 },
  copy: { position: "absolute", top: "64%", alignItems: "center", paddingHorizontal: 12 },
  winnerPill: { marginBottom: 8, paddingHorizontal: 14, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(248,215,116,0.16)", borderWidth: 1, borderColor: "rgba(248,215,116,0.48)" },
  winnerPillText: { color: "#f8d774", fontSize: 11, lineHeight: 15, fontFamily: "SpedaBold", writingDirection: "rtl" },
  eyebrow: { color: "rgba(255,255,255,0.78)", fontSize: 13, lineHeight: 19, fontFamily: "SpedaBold", textAlign: "center", writingDirection: "rtl" },
  title: { marginTop: 2, color: "#f8d774", fontSize: 20, lineHeight: 28, fontFamily: "SpedaBold", textAlign: "center", writingDirection: "rtl" },
});
