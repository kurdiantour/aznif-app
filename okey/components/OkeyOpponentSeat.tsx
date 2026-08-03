import { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";

import { styles } from "./okeyStyles";
import { useOkeyResponsiveLayout } from "../layout/OkeyResponsiveLayoutProvider";
import { OkeyTileBack } from "./OkeyTileFace";
import { OkeyTurnTimerBar } from "./OkeyTurnTimerBar";

const DEAL_STAGGER_MS = 95;
const DEAL_PLAYER_COUNT = 4;
const DEAL_DURATION_MS = 620;

function DealtOpponentBack({
  side,
  index,
  dealOrder,
  dealResetKey,
  dealOrigin,
  seatOrigin,
}: {
  side: "top" | "left" | "right";
  index: number;
  dealOrder: number;
  dealResetKey?: string;
  dealOrigin?: { x: number; y: number } | null;
  seatOrigin?: { x: number; y: number; width: number; height: number } | null;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DEAL_DURATION_MS,
      delay: dealOrder * DEAL_STAGGER_MS + index * DEAL_STAGGER_MS * DEAL_PLAYER_COUNT,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [dealOrder, dealResetKey, index, progress]);

  const globalFromX = dealOrigin && seatOrigin
    ? dealOrigin.x - (seatOrigin.x + seatOrigin.width / 2)
    : 0;
  const globalFromY = dealOrigin && seatOrigin
    ? dealOrigin.y - (seatOrigin.y + seatOrigin.height / 2)
    : side === "top" ? 190 : 360;
  const fromX = side === "left" ? -globalFromY : side === "right" ? globalFromY : globalFromX;
  const fromY = side === "left" ? globalFromX : side === "right" ? -globalFromX : globalFromY;
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1.8, 1] }) },
        ],
      }}
    >
      <OkeyTileBack small />
    </Animated.View>
  );
}

export function OkeyOpponentSeat({
  name,
  count,
  active,
  side,
  timerResetKey,
  dealResetKey,
  dealOrder = 0,
  dealOrigin,
  timerDurationMs = 3_000,
  onMeasured,
  onPress,
}: {
  name: string;
  count: number;
  active: boolean;
  side: "top" | "left" | "right";
  timerResetKey?: string;
  dealResetKey?: string;
  dealOrder?: number;
  dealOrigin?: { x: number; y: number } | null;
  timerDurationMs?: number;
  onMeasured?: (rect: { x: number; y: number; width: number; height: number }) => void;
  onPress?: () => void;
}) {
  const layout = useOkeyResponsiveLayout();
  const seatRef = useRef<View | null>(null);
  const targetBackCount = Math.min(7, Math.max(3, count));
  const [seatOrigin, setSeatOrigin] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [dealtTileCount, setDealtTileCount] = useState(count);

  useEffect(() => {
    setDealtTileCount(0);
    const timers = Array.from({ length: targetBackCount }, (_, index) =>
      setTimeout(() => {
        const dealtBackCount = index + 1;
        setDealtTileCount(Math.min(count, Math.ceil((dealtBackCount / targetBackCount) * count)));
      }, dealOrder * DEAL_STAGGER_MS + index * DEAL_STAGGER_MS * DEAL_PLAYER_COUNT),
    );
    return () => timers.forEach(clearTimeout);
  }, [count, dealOrder, dealResetKey, targetBackCount]);

  const measureSeat = () => {
    seatRef.current?.measureInWindow((x, y, width, height) => {
      const rect = { x, y, width, height };
      setSeatOrigin((current) =>
        current?.x === x && current?.y === y && current.width === width && current.height === height ? current : rect,
      );
      onMeasured?.(rect);
    });
  };

  return (
    <Pressable
      ref={seatRef}
      collapsable={false}
      onLayout={measureSeat}
      accessibilityRole="button"
      accessibilityLabel={`کردنەوەی پڕۆفایلی ${name}`}
      accessibilityHint="دوو جار لێبدە بۆ بینینی پڕۆفایل."
      accessibilityState={{ disabled: !onPress, selected: active }}
      accessibilityValue={{ text: `${count} بەرد` }}
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.opponentSeat,
        side === "top" && styles.topSeat,
        side === "left" && styles.leftSeat,
        side === "right" && styles.rightSeat,
        layout.seats[side],
      ]}
    >
      <View style={styles.opponentRack}>
        <OkeyTurnTimerBar
          active={active}
          durationMs={timerDurationMs}
          resetKey={timerResetKey}
          orientation={side === "top" ? "horizontal" : "vertical"}
          reverse={side !== "left"}
          style={side === "top" ? styles.opponentTimerTop : side === "left" ? styles.opponentTimerLeft : styles.opponentTimerRight}
        />
        {Array.from({ length: targetBackCount }).map((_, index) => (
          <DealtOpponentBack
            key={index}
            side={side}
            index={index}
            dealOrder={dealOrder}
            dealResetKey={dealResetKey}
            dealOrigin={dealOrigin}
            seatOrigin={seatOrigin}
          />
        ))}
      </View>
      <View style={styles.namePlate}>
        <Text style={styles.nameText}>{name}</Text>
        <Text style={styles.countText}>{dealtTileCount}</Text>
      </View>
    </Pressable>
  );
}

export const MemoizedOkeyOpponentSeat = memo(OkeyOpponentSeat);