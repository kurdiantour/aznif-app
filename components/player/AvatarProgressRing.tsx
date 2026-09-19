import type { AvatarId } from "@/types/avatar";
import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import { calculateLevelProgress } from "@/lib/progression";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";

type AvatarProgressRingProps = {
  avatarId?: AvatarId;
  avatarUrl?: string;
  points?: number | null;
  size?: number;
  strokeWidth?: number;
  gap?: number;
  trackColor?: string;
  progressColor?: string;
  style?: StyleProp<ViewStyle>;
};

export function AvatarProgressRing({
  avatarId,
  avatarUrl,
  points,
  size = 52,
  strokeWidth = 2.5,
  gap = 2,
  trackColor = "rgba(248, 215, 116, 0.22)",
  progressColor = "#f8d774",
  style,
}: AvatarProgressRingProps) {
  const progress = calculateLevelProgress(points);
  const clampedProgress = Math.min(1, Math.max(0, progress));

  const center = size / 2;
  const radius = Math.max(0, (size - strokeWidth) / 2);
  const circumference = 2 * Math.PI * radius;
  const filledLength = circumference * clampedProgress;
  const avatarSize = Math.max(10, Math.round(size - strokeWidth * 2 - gap * 2));

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
        },
        style,
      ]}
    >
      <Svg
        width={size}
        height={size}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />

        {clampedProgress >= 1 ? (
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={progressColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
        ) : clampedProgress > 0 ? (
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={progressColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${filledLength} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            rotation={-90}
            originX={center}
            originY={center}
          />
        ) : null}
      </Svg>

      <PlayerAvatar
        avatarId={avatarId}
        avatarUrl={avatarUrl}
        size={avatarSize}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
});
