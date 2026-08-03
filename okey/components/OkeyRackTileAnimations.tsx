import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing } from "react-native";

import { RACK_DEAL_BATCH_STAGGER_MS, RACK_TILE_ENTER_MS } from "@/okey/rack/rack-layout";

export { RACK_DEAL_BATCH_STAGGER_MS, RACK_TILE_ENTER_MS };

export function EnteringRackTile({
  children,
  height,
  fromX = 0,
  fromY,
  delay = 0,
}: {
  children: ReactNode;
  height: number;
  fromX?: number;
  fromY?: number;
  delay?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: RACK_TILE_ENTER_MS,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [delay, progress]);
  return (
    <Animated.View style={{
      opacity: progress.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0, 1, 1] }),
      transform: [
        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [fromY ?? -height * 4.2, 0] }) },
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] }) },
      ],
    }}>
      {children}
    </Animated.View>
  );
}

export function ReturningJokerTile({ children, height }: { children: ReactNode; height: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 760,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);
  return (
    <Animated.View style={{
      opacity: progress,
      transform: [
        { translateX: progress.interpolate({ inputRange: [0, 0.58, 1], outputRange: [52, -8, 0] }) },
        { translateY: progress.interpolate({ inputRange: [0, 0.72, 1], outputRange: [-height * 3.8, height * 0.12, 0] }) },
        { rotate: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: ["-18deg", "5deg", "0deg"] }) },
        { scale: progress.interpolate({ inputRange: [0, 0.72, 1], outputRange: [0.72, 1.08, 1] }) },
      ],
    }}>
      {children}
    </Animated.View>
  );
}
