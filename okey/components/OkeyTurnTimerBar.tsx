import { useEffect, useRef } from "react";
import { Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";

import { styles } from "./okeyStyles";

export function OkeyTurnTimerBar({
  active,
  durationMs = 20_000,
  resetKey,
  orientation = "horizontal",
  reverse = false,
  style,
}: {
  active: boolean;
  durationMs?: number;
  resetKey?: string;
  orientation?: "horizontal" | "vertical";
  reverse?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(1);
    if (!active) return;

    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: durationMs,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [active, durationMs, progress, resetKey]);

  const fillStyle = orientation === "horizontal"
    ? { width: "100%" as const, height: "100%" as const, transformOrigin: reverse ? "right center" as const : "left center" as const, transform: [{ scaleX: progress }] }
    : { width: "100%" as const, height: "100%" as const, transformOrigin: reverse ? "center top" as const : "center bottom" as const, transform: [{ scaleY: progress }] };

  return (
    <View
      pointerEvents="none"
      accessible={active}
      accessibilityRole="timer"
      accessibilityLabel={active ? `کاتی نۆبەت، ${Math.ceil(durationMs / 1000)} چرکە` : undefined}
      accessibilityLiveRegion="polite"
      style={[
        styles.turnTimerTrack,
        orientation === "vertical" ? styles.turnTimerTrackVertical : styles.turnTimerTrackHorizontal,
        reverse && (orientation === "vertical" ? styles.turnTimerReverseVertical : styles.turnTimerReverseHorizontal),
        style,
      ]}
    >
      <Animated.View style={[styles.turnTimerFill, fillStyle]} />
    </View>
  );
}
