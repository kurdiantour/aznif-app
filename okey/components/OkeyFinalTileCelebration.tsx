import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useAudioPlayer } from "expo-audio";

import { isOkeyWildcard } from "@/okey/engine/okey-engine";
import type { OkeyTile } from "@/okey/types/okey";
import { OkeyTileBack, OkeyTileFace } from "./OkeyTileFace";

type ScreenRect = { x: number; y: number; width: number; height: number };

type Props = {
  tile: OkeyTile | null;
  okeyTile: OkeyTile;
  sourceRect: ScreenRect | null;
  announcement?: string;
  onComplete?: () => void;
  playFinishSound?: boolean;
};

const SPARKS = Array.from({ length: 12 }, (_, index) => ({
  angle: `${index * 30}deg`,
  color: index % 3 === 0 ? "#fff5bd" : index % 2 === 0 ? "#f8d774" : "#f4a340",
  distance: 92 + (index % 3) * 18,
}));
const FINISH_SOUND = require("@/assets/audio/game/bang.mp3");

export const OKEY_FINAL_TILE_ANIMATION_MS = 2_000;
export const OKEY_FINAL_TILE_HOLD_MS = 3_000;
export const OKEY_FINAL_TILE_PRESENTATION_MS = 5_000;

export function OkeyFinalTileCelebration({ tile, okeyTile, sourceRect, announcement, onComplete, playFinishSound }: Props) {
  const entrance = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const onCompleteRef = useRef(onComplete);
  const finishSoundPlayer = useAudioPlayer(playFinishSound ? FINISH_SOUND : null);
  const soundPlayedRef = useRef(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const tileWidth = Math.max(58, (sourceRect?.width ?? 38) * 1.6);
  const tileHeight = Math.max(82, (sourceRect?.height ?? 54) * 1.6);
  const centerX = sourceRect ? sourceRect.x + sourceRect.width / 2 - tileWidth / 2 : screenWidth / 2 - tileWidth / 2;
  const centerY = sourceRect ? sourceRect.y + sourceRect.height / 2 - tileHeight / 2 : screenHeight / 2 - tileHeight / 2 - 28;
  const copyWidth = Math.min(230, screenWidth - 24);
  const copyLeft = Math.max(12, Math.min(screenWidth - copyWidth - 12, centerX + tileWidth / 2 - copyWidth / 2));
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!playFinishSound || soundPlayedRef.current) return;
    soundPlayedRef.current = true;
    let active = true;

    finishSoundPlayer.volume = 0.18;
    void finishSoundPlayer
      .seekTo(0, 0, 0)
      .then(() => {
        if (active) finishSoundPlayer.play();
      })
      .catch((error) => {
        console.warn("Unable to play Okey finish preview sound", error);
      });

    return () => {
      active = false;
      try {
        finishSoundPlayer.pause();
      } catch {}
      void finishSoundPlayer.seekTo(0, 0, 0).catch(() => undefined);
    };
  }, [finishSoundPlayer, playFinishSound]);

  useEffect(() => {
    entrance.setValue(0);
    pulse.setValue(0);
    const reveal = Animated.timing(entrance, {
      toValue: 1,
      duration: OKEY_FINAL_TILE_ANIMATION_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const presentationTimer = setTimeout(() => {
      onCompleteRef.current?.();
    }, OKEY_FINAL_TILE_PRESENTATION_MS);
    reveal.start(({ finished }) => {
      if (!finished) return;
      breathing.start();
    });
    return () => {
      reveal.stop();
      breathing.stop();
      clearTimeout(presentationTimer);
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
        {SPARKS.map((spark, index) => (
          <Animated.View
            key={`spark-${index}`}
            style={[
              styles.spark,
              {
                backgroundColor: spark.color,
                opacity: entrance.interpolate({ inputRange: [0.45, 0.78, 1], outputRange: [0, 1, 0.7] }),
                transform: [
                  { rotate: spark.angle },
                  {
                    translateY: entrance.interpolate({
                      inputRange: [0.45, 1],
                      outputRange: [0, -spark.distance],
                    }),
                  },
                  {
                    scale: entrance.interpolate({
                      inputRange: [0.45, 0.8, 1],
                      outputRange: [0.2, 1.25, 0.85],
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
        <Animated.View
          style={[
            styles.tileWrap,
            {
              transform: [
                {
                  scale: entrance.interpolate({
                    inputRange: [0, 0.62, 0.86, 1],
                    outputRange: [0.35, 1.18, 0.96, 1],
                  }),
                },
                {
                  rotateZ: entrance.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: ["-18deg", "6deg", "0deg"],
                  }),
                },
                { scale: pulseScale },
              ],
            },
          ]}
        >
          {tile ? (
            <OkeyTileFace
              tile={tile}
              width={tileWidth}
              height={tileHeight}
              isWildcard={isOkeyWildcard(tile, okeyTile)}
            />
          ) : (
            <OkeyTileBack width={tileWidth} height={tileHeight} />
          )}
        </Animated.View>
      </View>
      <Animated.View
        style={[
          styles.banner,
          {
            left: copyLeft,
            top: centerY + tileHeight + 14,
            width: copyWidth,
            opacity: entrance.interpolate({ inputRange: [0.55, 0.88, 1], outputRange: [0, 0.95, 1] }),
            transform: [
              {
                translateY: entrance.interpolate({
                  inputRange: [0.55, 1],
                  outputRange: [18, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={styles.bannerKicker}>دەستی تەواوکەر</Text>
        <Text style={styles.bannerTitle} numberOfLines={1}>
          {announcement ?? "تاشی سەرکەوتن"}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 90,
    elevation: 90,
    justifyContent: "center",
    alignItems: "center",
  },
  flash: {
    position: "absolute",
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#fff6bf",
  },
  spotlight: {
    position: "absolute",
    width: 250,
    height: 380,
    borderRadius: 125,
    backgroundColor: "rgba(255, 224, 130, 0.22)",
  },
  stage: {
    position: "absolute",
    justifyContent: "center",
    alignItems: "center",
  },
  tileWrap: {
    shadowColor: "#f7cf57",
    shadowOpacity: 0.85,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  cinematicRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 1.5,
  },
  outerRing: {
    width: 170,
    height: 170,
    borderColor: "rgba(255, 230, 140, 0.65)",
  },
  innerRing: {
    width: 130,
    height: 130,
    borderColor: "rgba(255, 196, 70, 0.5)",
    borderStyle: "dashed",
  },
  ringGem: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#fff6ca",
  },
  ringGemTop: {
    top: -4,
    left: "50%",
    marginLeft: -3.5,
  },
  ringGemBottom: {
    bottom: -4,
    left: "50%",
    marginLeft: -3.5,
  },
  ringGemLeft: {
    left: -4,
    top: "50%",
    marginTop: -3.5,
  },
  ringGemRight: {
    right: -4,
    top: "50%",
    marginTop: -3.5,
  },
  spark: {
    position: "absolute",
    width: 5,
    height: 14,
    borderRadius: 2.5,
  },
  banner: {
    position: "absolute",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(10, 18, 30, 0.88)",
    borderWidth: 1,
    borderColor: "rgba(247, 207, 87, 0.45)",
  },
  bannerKicker: {
    color: "#f8d977",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  bannerTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2,
    textAlign: "center",
  },
});
