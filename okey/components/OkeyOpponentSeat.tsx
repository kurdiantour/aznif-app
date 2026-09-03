import { memo, useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";

import { styles } from "./okeyStyles";
import { useOkeyResponsiveLayout } from "../layout/OkeyResponsiveLayoutProvider";
import { OkeyTileBack } from "./OkeyTileFace";
import { OkeyTurnTimerBar } from "./OkeyTurnTimerBar";


export function OkeyOpponentSeat({
  playerId,
  name,
  count,
  active,
  side,
  turnTimeLeftMilliseconds,
  turnDeadlineAt,
  serverClockOffsetMs,
  turnDurationSeconds,
  turnTimerPhase = "throw",
  onMeasured,
  onPress,
}: {
  playerId?: string;
  name: string;
  count: number;
  active: boolean;
  side: "top" | "left" | "right";
  turnTimeLeftMilliseconds: number;
  turnDeadlineAt: string | null;
  serverClockOffsetMs: number;
  turnDurationSeconds: number | null;
  turnTimerPhase?: "draw" | "throw";
  onMeasured?: (rect: { x: number; y: number; width: number; height: number }) => void;
  onPress?: () => void;
}) {
  const layout = useOkeyResponsiveLayout();
  const seatRef = useRef<View | null>(null);
  const targetBackCount = count > 0 ? Math.min(7, Math.max(1, count)) : 0;
  const measureSeat = () => {
    seatRef.current?.measureInWindow((x, y, width, height) => {
      const rect = { x, y, width, height };
      onMeasured?.(rect);
    });
  };

  // PRESENTATION CONTRACT (tested): a waiting placeholder can become a real
  // player without a layout change. This re-measure keeps playerId → screen
  // rect mapping valid for every opponent flight; do not remove without full
  // multiplayer animation coverage.
  // Re-measure after a waiting seat receives its real player identity.
  useEffect(() => {
    const frame = requestAnimationFrame(measureSeat);
    return () => cancelAnimationFrame(frame);
  }, [playerId]);

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
          deadlineAt={turnDeadlineAt}
          serverClockOffsetMs={serverClockOffsetMs}
          remainingMilliseconds={turnTimeLeftMilliseconds}
          durationSeconds={turnDurationSeconds}
          phase={turnTimerPhase}
          orientation="horizontal"
          reverse={side !== "left"}
          style={side === "top" ? styles.opponentTimerTop : side === "left" ? styles.opponentTimerLeft : styles.opponentTimerRight}
        />
        {Array.from({ length: targetBackCount }).map((_, index) => (
          <OkeyTileBack key={index} small />
        ))}
      </View>
      <View style={styles.namePlate}>
        <Text style={styles.nameText} numberOfLines={1} ellipsizeMode="tail">{name}</Text>
      </View>
    </Pressable>
  );
}

export const MemoizedOkeyOpponentSeat = memo(OkeyOpponentSeat);
