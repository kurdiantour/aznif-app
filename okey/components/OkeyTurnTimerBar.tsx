import { useEffect, useRef } from "react";
import {
  Animated,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { LinearGradient } from "expo-linear-gradient";

import { styles } from "./okeyStyles";

export function OkeyTurnTimerBar({
  active,
  visible = true,
  remainingSeconds,
  durationSeconds,
  phase = "throw",
  orientation = "horizontal",
  reverse = false,
  style,
}: {
  active: boolean;
  visible?: boolean;
  remainingSeconds: number;
  durationSeconds: number | null;
  phase?: "draw" | "throw";
  orientation?: "horizontal" | "vertical";
  reverse?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    progress.stopAnimation();

    const duration =
      typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds
        : 0;
    const remaining = Number.isFinite(remainingSeconds)
      ? Math.max(0, remainingSeconds)
      : 0;

    if (!active || duration <= 0) {
      progress.setValue(0);
      return;
    }

    progress.setValue(Math.min(1, remaining / duration));
  }, [active, durationSeconds, progress, remainingSeconds]);

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
          ? `کاتی نۆبەت، ${Math.ceil(Math.max(0, remainingSeconds))} چرکە`
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
          phase === "draw" && styles.turnTimerFillDraw,
          fillStyle,
          !visible && { opacity: 0 },
        ]}
      >
        {phase === "draw" ? (
          <LinearGradient
            colors={["#0b5d2a", "#35d06f", "#168a45"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}