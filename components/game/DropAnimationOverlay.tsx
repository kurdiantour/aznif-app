import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import DominoTile from '@/components/game/DominoTile';
import type { DominoTileData } from '@/domino/types/domino-game';

type Props = {
  tile: DominoTileData;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  onDone: () => void;
};

export default function DropAnimationOverlay({
  tile,
  startX,
  startY,
  endX,
  endY,
  onDone,
}: Props) {
  const drag = useRef(
    new Animated.ValueXY({
      x: 0,
      y: 0,
    })
  ).current;

  useEffect(() => {
    const targetDragX = endX - startX;
    const targetDragY = endY - startY;

    Animated.timing(drag, {
      toValue: {
        x: targetDragX,
        y: targetDragY,
      },
      duration: 750,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onDone();
      }
    });

    return () => {
      drag.stopAnimation();
    };
  }, [startX, startY, endX, endY, onDone, drag]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        {
          left: startX,
          top: startY,
          transform: [
            { translateX: drag.x },
            { translateY: drag.y },
          ],
        },
      ]}
    >
      <DominoTile tile={tile} width={28} height={70} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 999,
  },
});