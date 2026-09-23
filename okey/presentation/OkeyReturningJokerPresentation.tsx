import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Animated, Easing } from "react-native";

import { OkeyTileFace } from "@/okey/components/OkeyTileFace";
import { styles } from "@/okey/components/okeyStyles";
import type { OkeyTile } from "@/okey/types/okey";
import type { ScreenRect } from "./okey-game-presentation";

type ReturningTile = { tile: OkeyTile; rect: ScreenRect | null };

/** Owns the visual arrival only; rack layout and gameplay never wait for it. */
export function useOkeyReturningJokerPresentation(tiles: OkeyTile[], resetKey: string) {
  const previous = useRef({ resetKey, ids: new Set(tiles.map((tile) => tile.id)) });
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [arrivals, setArrivals] = useState<ReturningTile[]>([]);

  const dismiss = useCallback((tileId: string) => {
    clearTimeout(timers.current.get(tileId));
    timers.current.delete(tileId);
    setArrivals((current) => current.some(({ tile }) => tile.id === tileId)
      ? current.filter(({ tile }) => tile.id !== tileId) : current);
  }, []);

  useLayoutEffect(() => {
    const ids = new Set(tiles.map((tile) => tile.id));
    const reset = previous.current.resetKey !== resetKey;
    const added = reset ? [] : tiles.filter((tile) =>
      tile.jokerOrigin === "stolen" && !previous.current.ids.has(tile.id));
    previous.current = { resetKey, ids };
    for (const [id, timer] of timers.current) {
      if (reset || !ids.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
    setArrivals((current) => {
      const retained = reset ? [] : current.filter(({ tile }) => ids.has(tile.id));
      if (!reset && retained.length === current.length && !added.length) return current;
      return [...retained, ...added.map((tile) => ({ tile, rect: null }))];
    });
    for (const tile of added) {
      // Also releases arrivals for which no rack measurement becomes available.
      timers.current.set(tile.id, setTimeout(() => dismiss(tile.id), 900));
    }
  }, [dismiss, resetKey, tiles]);

  useLayoutEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach(clearTimeout);
      activeTimers.clear();
    };
  }, []);

  const onTileMeasured = useCallback((tileId: string, rect: ScreenRect) => {
    setArrivals((current) => {
      const arrival = current.find(({ tile }) => tile.id === tileId);
      if (!arrival || (arrival.rect?.x === rect.x && arrival.rect.y === rect.y &&
        arrival.rect.width === rect.width && arrival.rect.height === rect.height)) return current;
      return current.map((entry) => entry === arrival ? { ...entry, rect } : entry);
    });
  }, []);

  return { arrivals, dismiss, onTileMeasured };
}

export function OkeyReturningJokerOverlay({ tile, rect, onDone }: {
  tile: OkeyTile;
  rect: ScreenRect;
  onDone: (tileId: string) => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1, duration: 760, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    animation.start(({ finished }) => { if (finished) onDone(tile.id); });
    return () => animation.stop();
  }, [onDone, progress, tile.id]);

  return (
    <Animated.View pointerEvents="none" style={[styles.tileFlightOverlay, {
      left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity: progress,
      transform: [
        { translateX: progress.interpolate({ inputRange: [0, 0.58, 1], outputRange: [52, -8, 0] }) },
        { translateY: progress.interpolate({ inputRange: [0, 0.72, 1], outputRange: [-rect.height * 3.8, rect.height * 0.12, 0] }) },
        { rotate: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: ["-18deg", "5deg", "0deg"] }) },
        { scale: progress.interpolate({ inputRange: [0, 0.72, 1], outputRange: [0.72, 1.08, 1] }) },
      ],
    }]}>
      <OkeyTileFace tile={tile} isWildcard width={rect.width} height={rect.height} />
    </Animated.View>
  );
}
