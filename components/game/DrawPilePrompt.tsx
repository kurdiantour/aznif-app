import { useEffect, useRef } from "react";
import { BlurView } from "expo-blur";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";

import DominoTile from "@/components/game/DominoTile";
import { DominoTileData } from "@/domino/types/domino-game";

const PASS_AUTO_SECONDS = 10;
const TIMER_SIZE = 68;
const TIMER_STROKE = 5;
const TIMER_RADIUS = (TIMER_SIZE - TIMER_STROKE) / 2;
const TIMER_CIRCUMFERENCE = 2 * Math.PI * TIMER_RADIUS;

const HIDDEN_BONEYARD_TILE: DominoTileData = {
  id: "draw-prompt-hidden-boneyard",
  left: 0,
  right: 0,
  imageKey: "0-0",
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type DrawPilePromptProps = {
  visible: boolean;
  gameMode?: "1v1" | "2v2";
  boneyardCount: number;
  onDraw: () => void;
  onPass?: () => void;
  passCountdown?: number;
  drawCountdown?: number;
  passing?: boolean;
};

export default function DrawPilePrompt({
  visible,
  gameMode = "1v1",
  boneyardCount,
  onDraw,
  onPass,
  passCountdown,
  drawCountdown,
  passing = false,
}: DrawPilePromptProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const progressValue = useRef(new Animated.Value(0)).current;
  const onPassRef = useRef(onPass);

  onPassRef.current = onPass;

  const isTwoVsTwoGame = gameMode === "2v2";
  const hasTiles = boneyardCount > 0;
  const isCompact = screenWidth < 700 || screenHeight < 380;

  const drawProgress =
  typeof drawCountdown === "number"
    ? Math.max(0, Math.min(1, drawCountdown / 5))
    : 0;

  const boneyardTiles = Array.from({ length: Math.max(0, boneyardCount) });
  const boneyardColumns = isCompact ? 4 : 5;
  const boneyardRows = boneyardTiles.reduce<number[][]>(
    (rows, _, index) => {
      const rowIndex = Math.floor(index / boneyardColumns);

      if (!rows[rowIndex]) {
        rows[rowIndex] = [];
      }

      rows[rowIndex].push(index);
      return rows;
    },
    [],
  );
  useEffect(() => {
    if (
      !visible ||
      hasTiles ||
      passing ||
      !onPassRef.current
    ) {
      progressValue.stopAnimation();
      progressValue.setValue(0);
      return;
    }

    progressValue.stopAnimation();
    progressValue.setValue(0);

    const animation = Animated.timing(progressValue, {
      toValue: 1,
      duration: PASS_AUTO_SECONDS * 1000,
      useNativeDriver: false,
    });

    animation.start(({ finished }) => {
      if (finished) {
        onPassRef.current?.();
      }
    });

    return () => {
      animation.stop();
    };
  }, [visible, hasTiles, passing, progressValue]);

  const strokeDashoffset = progressValue.interpolate({
    inputRange: [0, 1],
    outputRange: [TIMER_CIRCUMFERENCE, 0],
  });

  if (!visible) return null;

  if (isTwoVsTwoGame && !hasTiles) {
    return (
      <View style={styles.humanPassWrap} pointerEvents="box-none">
        <View style={styles.humanPassCard}>
          <Pressable
            style={[styles.humanPassButton, passing && styles.buttonDisabled]}
            onPress={onPass}
            disabled={passing || !onPass}
          >
            <View style={styles.timerCircle}>
              <Svg
                width={TIMER_SIZE}
                height={TIMER_SIZE}
                viewBox={`0 0 ${TIMER_SIZE} ${TIMER_SIZE}`}
                style={styles.timerSvg}
              >
                <Circle
                  cx={TIMER_SIZE / 2}
                  cy={TIMER_SIZE / 2}
                  r={TIMER_RADIUS}
                  stroke="rgba(250, 204, 21, 0.22)"
                  strokeWidth={TIMER_STROKE}
                  fill="transparent"
                />

                <AnimatedCircle
                  cx={TIMER_SIZE / 2}
                  cy={TIMER_SIZE / 2}
                  r={TIMER_RADIUS}
                  stroke="#facc15"
                  strokeWidth={TIMER_STROKE}
                  fill="transparent"
                  strokeLinecap="round"
                  strokeDasharray={`${TIMER_CIRCUMFERENCE} ${TIMER_CIRCUMFERENCE}`}
                  strokeDashoffset={strokeDashoffset}
                  rotation="-90"
                  originX={TIMER_SIZE / 2}
                  originY={TIMER_SIZE / 2}
                />
              </Svg>

              <View style={styles.humanPassRing}>
                <Text style={styles.humanPassButtonText}>
                  {passing ? "..." : "پاس"}
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.boneyardOverlay} pointerEvents="box-none">
      <View style={styles.scrim} pointerEvents="none" />

      <BlurView
        intensity={35}
        tint="dark"
        style={[
          styles.boneyardPanel,
          isCompact && styles.boneyardPanelCompact,
        ]}
      >
        <View
          style={[
            styles.boneyardGrid,
            isCompact && styles.boneyardGridCompact,
          ]}
        >
          {hasTiles ? (
            boneyardRows.map((row, rowIndex) => (
              <View
                key={`draw-pile-row-${rowIndex}`}
                style={styles.boneyardTileRow}
              >
                {row.map((index) => (
                  <Pressable
                    key={`draw-pile-tile-${index}`}
                    onPress={onDraw}
                    style={[
                      styles.boneyardTileButton,
                      {
                        transform: [
                          { rotate: `${index % 2 === 0 ? -2 : 2}deg` },
                        ],
                      },
                    ]}
                  >
                    <DominoTile
                      tile={HIDDEN_BONEYARD_TILE}
                      width={isCompact ? 26 : 32}
                      height={isCompact ? 54 : 66}
                    />
                  </Pressable>
                ))}
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>کۆمەڵەکە بەتاڵە.</Text>
          )}
        </View>

        {gameMode === "1v1" &&
  hasTiles &&
  typeof drawCountdown === "number" && (
    <View style={styles.drawProgressTrack}>
      <View
        style={[
          styles.drawProgressFill,
          { width: `${drawProgress * 100}%` },
        ]}
      />
    </View>
  )}

        {!hasTiles && onPass && (
          <Pressable
            style={[styles.humanPassButton, styles.oneVsOnePassButton, passing && styles.buttonDisabled]}
            onPress={onPass}
            disabled={passing}
          >
            <View style={styles.timerCircle}>
              <Svg width={TIMER_SIZE} height={TIMER_SIZE} viewBox={`0 0 ${TIMER_SIZE} ${TIMER_SIZE}`} style={styles.timerSvg}>
                <Circle cx={TIMER_SIZE / 2} cy={TIMER_SIZE / 2} r={TIMER_RADIUS} stroke="rgba(250, 204, 21, 0.22)" strokeWidth={TIMER_STROKE} fill="transparent" />
                <AnimatedCircle cx={TIMER_SIZE / 2} cy={TIMER_SIZE / 2} r={TIMER_RADIUS} stroke="#facc15" strokeWidth={TIMER_STROKE} fill="transparent" strokeLinecap="round" strokeDasharray={`${TIMER_CIRCUMFERENCE} ${TIMER_CIRCUMFERENCE}`} strokeDashoffset={strokeDashoffset} rotation="-90" originX={TIMER_SIZE / 2} originY={TIMER_SIZE / 2} />
              </Svg>
              <View style={styles.humanPassRing}>
                <Text style={styles.humanPassButtonText}>{passing ? "..." : "پاس"}</Text>
              </View>
            </View>
          </Pressable>
        )}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  boneyardOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 130,
  },

  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(9, 3, 18, 0.24)",
  },

boneyardPanel: {
  position: "absolute",
  top: "46%",
  width: "86%",
  maxWidth: 400,
  minHeight: 180,
  borderRadius: 6,
  overflow: "hidden",
  paddingHorizontal: 14,
  paddingBottom: 26,
  alignItems: "center",
  backgroundColor: "rgba(58, 25, 92, 0.18)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.14)",
  shadowColor: "#000",
  shadowOpacity: 0.28,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 20,
},

boneyardPanelCompact: {
  width: "84%",
  minHeight: 104,
  top: "42%",
  paddingHorizontal: 12,
  paddingBottom: 14,
},

boneyardGrid: {
  width: "100%",
  minHeight: 78,
  paddingTop: 20,
  alignItems: "center",
  justifyContent: "center",
},

boneyardGridCompact: {
  minHeight: 68,
  paddingTop: 6,
},

boneyardTileRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
},

boneyardTileButton: {
  width: 32,
  height: 66,
  marginHorizontal: 3,
  marginVertical: 3,
  borderRadius: 8,
  shadowColor: "#000",
  shadowOpacity: 0.24,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 3 },
  elevation: 8,
},

  emptyText: {
    marginTop: 14,
    color: "rgba(255, 255, 255, 0.78)",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  passButton: {
    marginTop: 12,
    width: 58,
    height: 58,
    paddingHorizontal: 18,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.22)",
  },

  passButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  buttonDisabled: {
    opacity: 0.6,
  },

drawProgressTrack: {
  position: "absolute",
  left: "9%",
  right: "9%",
  bottom: 10,
  height: 4,
  borderRadius: 999,
  overflow: "hidden",
  backgroundColor: "rgba(255,255,255,0.16)",
},

drawProgressFill: {
  height: "100%",
  borderRadius: 999,
  backgroundColor: "#facc15",
},

  passCountdown: {
    marginTop: 9,
    color: "#facc15",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  humanPassWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 84,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 140,
  },

  humanPassCard: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
  },

  humanPassButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  oneVsOnePassButton: {
    marginTop: 12,
  },

  timerCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
  },

  timerSvg: {
    position: "absolute",
  },

  humanPassRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#d7b94b",
    borderWidth: 2,
    borderColor: "#fff3b0",
  },

  humanPassButtonText: {
    color: "#3b2a10",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
});
