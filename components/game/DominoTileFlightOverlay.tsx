import DominoTile from "@/components/game/DominoTile";
import type { DominoTileFlight } from "@/domino/shared/presentation/domino-tile-flight";
import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet } from "react-native";

const FLIGHT_DURATION_MS = 700;

export default function DominoTileFlightOverlay({ flight, onDone }: { flight: DominoTileFlight; onDone: () => void }) {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: FLIGHT_DURATION_MS,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => finished && onDone());
  return () => animation.stop();
  }, [flight.id, onDone, progress]);

  const translateX = (flight.to.x + flight.to.width / 2) - (flight.from.x + flight.from.width / 2);
  const translateY = (flight.to.y + flight.to.height / 2) - (flight.from.y + flight.from.height / 2);
  const sourceLongSide = Math.max(flight.from.width, flight.from.height);
  const targetLongSide = Math.max(flight.to.width, flight.to.height);
  const landingScale = targetLongSide / Math.max(1, sourceLongSide);
  const startRotation = flight.from.rotation ?? 0;
  const rawRotationDelta = (flight.to.rotation ?? 0) - startRotation;
  const rotationDelta = ((rawRotationDelta + 540) % 360) - 180;
  return (
    <Animated.View pointerEvents="none" style={[styles.tile, {
      left: flight.from.x,
      top: flight.from.y,
      width: flight.from.width,
      height: flight.from.height,
      transform: [
        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, translateX] }) },
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, translateY] }) },
        { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: [`${startRotation}deg`, `${startRotation + rotationDelta}deg`] }) },
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, landingScale] }) },
      ],
    }]}>
      <DominoTile tile={flight.tile} width={flight.from.width} height={flight.from.height} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({ tile: { position: "absolute", zIndex: 1000, elevation: 30 } });
