import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";

import { OkeyTileBack, OkeyTileFace } from "@/okey/components/OkeyTileFace";
import { styles } from "@/okey/components/okeyStyles";
import { isOkeyWildcard } from "@/okey/engine/okey-engine";
import type { TileFlight } from "@/okey/presentation/okey-game-presentation";
import type { OkeyTile } from "@/okey/types/okey";

export function OkeyTileFlightOverlay({
  flight,
  okeyTile,
  onDone,
}: {
  flight: TileFlight;
  okeyTile: OkeyTile;
  onDone: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const onDoneRef = useRef(onDone);
  const deltaX = flight.to.x - flight.from.x;
  const deltaY = flight.to.y - flight.from.y;
  const arcHeight = Math.min(150, Math.max(52, Math.hypot(deltaX, deltaY) * 0.14));
  const midArcY = deltaY / 2 - arcHeight;

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 600,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }: { finished: boolean }) => {
      if (finished) onDoneRef.current();
    });
    return () => animation.stop();
  }, [flight.id, progress]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.tileFlightOverlay,
        {
          left: flight.from.x,
          top: flight.from.y,
          width: flight.from.width,
          height: flight.from.height,
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, deltaX] }) },
            { translateY: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, midArcY, deltaY] }) },
          ],
        },
      ]}
    >
      {flight.face === "back" || !flight.tile ? (
        <OkeyTileBack />
      ) : (
        <OkeyTileFace
          tile={flight.tile}
          width={flight.from.width}
          height={flight.from.height}
          isWildcard={isOkeyWildcard(flight.tile, okeyTile)}
        />
      )}
    </Animated.View>
  );
}
