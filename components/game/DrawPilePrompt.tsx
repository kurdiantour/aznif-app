import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

const PASS_AUTO_SECONDS = 10;
const TIMER_SIZE = 68;
const TIMER_STROKE = 5;
const TIMER_RADIUS = (TIMER_SIZE - TIMER_STROKE) / 2;
const TIMER_CIRCUMFERENCE = 2 * Math.PI * TIMER_RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type DrawPilePromptProps = {
  visible: boolean;
  gameMode?: "1v1" | "2v2";
  boneyardCount: number;
  onDraw: () => void;
  onPass?: () => void;
  passCountdown?: number;
  passing?: boolean;
};

export default function DrawPilePrompt({
  visible,
  gameMode = "1v1",
  boneyardCount,
  onDraw,
  onPass,
  passCountdown,
  passing = false,
}: DrawPilePromptProps) {
  const progressValue = useRef(new Animated.Value(0)).current;
  const onPassRef = useRef(onPass);

  onPassRef.current = onPass;

  const isTwoVsTwoGame = gameMode === "2v2";
  const hasTiles = boneyardCount > 0;

  useEffect(() => {
    if (
      !visible ||
      !isTwoVsTwoGame ||
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
  }, [visible, isTwoVsTwoGame, hasTiles, passing, progressValue]);

  const strokeDashoffset = progressValue.interpolate({
    inputRange: [0, 1],
    outputRange: [TIMER_CIRCUMFERENCE, 0],
  });

  if (!visible) return null;

  if (isTwoVsTwoGame && !hasTiles) {
    return (
      <View style={styles.humanPassWrap} pointerEvents="box-none">
        <View style={styles.humanPassCard}>
          <View style={styles.humanPassTextBox}>
            <Text style={styles.humanPassTitle}>پاس</Text>
            <Text style={styles.humanPassSubtitle}>
              هیچ خشتێکی گونجاوت نییە.
            </Text>
          </View>

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
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <Text style={styles.title}>هیچ خشتێکی یاریکردن نییە</Text>

        <Text style={styles.subtitle}>
          {hasTiles
            ? "Draw a hidden domino from the pile to continue."
            : "You have no legal move. Pass the turn to continue."}
        </Text>

        {hasTiles ? (
          <Pressable style={styles.drawButton} onPress={onDraw}>
            <Text style={styles.drawButtonText}>خشت وەربگرە</Text>
          </Pressable>
        ) : (
          <Text style={styles.emptyText}>کۆمەڵەکە بەتاڵە.</Text>
        )}

        <Text style={styles.countText}>{boneyardCount} tiles left</Text>

        {!hasTiles && onPass && (
          <Pressable
            style={[styles.passButton, passing && styles.buttonDisabled]}
            onPress={onPass}
            disabled={passing}
          >
            <Text style={styles.passButtonText}>
              {passing ? "Passing..." : "Pass Turn"}
            </Text>
          </Pressable>
        )}

        {!hasTiles && typeof passCountdown === "number" && (
          <Text style={styles.passCountdown}>
            Auto-pass in {passCountdown}s
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 76,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 120,
  },

  card: {
    width: 292,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 14,
    alignItems: "center",
    backgroundColor: "rgba(3, 17, 11, 0.97)",
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.4)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },

  title: {
    color: "#ffffff",
    fontSize: 16,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  subtitle: {
    marginTop: 5,
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 12,
    fontFamily: "SpedaBold",
    lineHeight: 16,
    textAlign: "center",
  },

  drawButton: {
    width: 184,
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#8b5cf6",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },

  drawButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
    letterSpacing: 0.4,
  },

  countText: {
    marginTop: 10,
    color: "#facc15",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
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
    minWidth: 132,
    height: 40,
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
    fontSize: 13,
    fontFamily: "SpedaBold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  buttonDisabled: {
    opacity: 0.6,
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
    width: 300,
    minHeight: 76,
    borderRadius: 18,
    paddingLeft: 18,
    paddingRight: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(62, 35, 18, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.38)",
    shadowColor: "#000",
    shadowOpacity: 0.38,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },

  humanPassTextBox: {
    flex: 1,
    paddingRight: 12,
  },

  humanPassTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontFamily: "SpedaBold",
    textAlign: "left",
  },

  humanPassSubtitle: {
    marginTop: 4,
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "left",
  },

  humanPassButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
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
