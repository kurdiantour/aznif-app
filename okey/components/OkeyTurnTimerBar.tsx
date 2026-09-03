import { useLayoutEffect, useRef } from "react";
import {
  Animated,
  Easing,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { LinearGradient } from "expo-linear-gradient";

import { styles } from "./okeyStyles";

const PHASE_COLOR_TRANSITION_MS = 220;

export function OkeyTurnTimerBar({
  active,
  visible = true,
  deadlineAt,
  serverClockOffsetMs,
  remainingMilliseconds,
  durationSeconds,
  phase = "throw",
  orientation = "horizontal",
  reverse = false,
  style,
}: {
  active: boolean;
  visible?: boolean;
  deadlineAt: string | null;
  serverClockOffsetMs: number;
  remainingMilliseconds: number;
  durationSeconds: number | null;
  phase?: "draw" | "throw";
  orientation?: "horizontal" | "vertical";
  reverse?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const drawColorMix = useRef(
    new Animated.Value(phase === "draw" ? 1 : 0),
  ).current;

  useLayoutEffect(() => {
    progress.stopAnimation();

    const durationMilliseconds =
      typeof durationSeconds === "number" &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > 0
        ? durationSeconds * 1_000
        : 0;
    const deadlineMilliseconds = deadlineAt ? Date.parse(deadlineAt) : Number.NaN;

    if (
      !active ||
      durationMilliseconds <= 0 ||
      !Number.isFinite(deadlineMilliseconds)
    ) {
      progress.setValue(0);
      return;
    }

    const serverNowMilliseconds = Date.now() + serverClockOffsetMs;
    const timeLeftMilliseconds = Math.max(
      0,
      deadlineMilliseconds - serverNowMilliseconds,
    );
    const initialProgress = Math.min(
      1,
      timeLeftMilliseconds / durationMilliseconds,
    );

    // Every authoritative deadline is one timer segment. Start exactly at the
    // server-derived position, then run continuously to zero. The visual
    // countdown follows the authoritative deadline directly.
    progress.setValue(initialProgress);

    Animated.timing(progress, {
      toValue: 0,
      duration: timeLeftMilliseconds,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [
    active,
    deadlineAt,
    durationSeconds,
    progress,
    serverClockOffsetMs,
  ]);

  useLayoutEffect(() => {
    drawColorMix.stopAnimation();

    if (phase === "draw") {
      // DRAW starts green immediately. There must never be a red frame before
      // the authoritative draw phase becomes visible.
      drawColorMix.setValue(1);
      return;
    }

    // The phase transition from DRAW to THROW is intentionally visualized
    // as a smooth green-to-red handoff.
    Animated.timing(drawColorMix, {
      toValue: 0,
      duration: PHASE_COLOR_TRANSITION_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [drawColorMix, phase]);

  const fillStyle =
    orientation === "horizontal"
      ? {
          width: "100%" as const,
          height: "100%" as const,
          transformOrigin: reverse
            ? ("right center" as const)
            : ("left center" as const),
          transform: [{ scaleX: progress }],
        }
      : {
          width: "100%" as const,
          height: "100%" as const,
          transformOrigin: reverse
            ? ("center top" as const)
            : ("center bottom" as const),
          transform: [{ scaleY: progress }],
        };

  return (
    <View
      pointerEvents="none"
      accessible={active && visible}
      accessibilityRole="timer"
      accessibilityLabel={
        active && visible
          ? `کاتی نۆبەت، ${Math.ceil(Math.max(0, remainingMilliseconds) / 1_000)} چرکە`
          : undefined
      }
      accessibilityLiveRegion="polite"
      style={[
        styles.turnTimerTrack,
        orientation === "vertical"
          ? styles.turnTimerTrackVertical
          : styles.turnTimerTrackHorizontal,
        reverse &&
          (orientation === "vertical"
            ? styles.turnTimerReverseVertical
            : styles.turnTimerReverseHorizontal),
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.turnTimerFill,
          fillStyle,
          !visible && { opacity: 0 },
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", inset: 0 },
            { opacity: drawColorMix },
          ]}
        >
          <LinearGradient
            colors={["#0b5d2a", "#35d06f", "#168a45"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

