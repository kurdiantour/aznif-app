import { DominoTileData } from '@/types/game';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  type PanResponderInstance,
  StyleSheet,
  View,
} from 'react-native';
import DominoTile from './DominoTile';

type Props = {
  tiles: DominoTileData[];
  onPlayTile: (tile: DominoTileData) => void;
  onSelectTile?: (tile: DominoTileData) => void;
  disabled?: boolean;
  selectedTileId?: string | null;
  playableTileIds?: string[];
};

const TILE_WIDTH = 28;
const TILE_HEIGHT = 70;
const TILE_GAP = 3;
const SLOT_WIDTH = TILE_WIDTH + TILE_GAP;

const HAND_WIDTH = 450;
const HAND_HEIGHT = 88;

const TILE_TOP = 30;
const DROP_TO_BOARD_DISTANCE = -10;

function moveTile(list: DominoTileData[], from: number, to: number) {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export default function PlayerHand({
  tiles,
  onPlayTile,
  onSelectTile,
  disabled = false,
  selectedTileId = null,
  playableTileIds = [],
}: Props) {
  const [localTiles, setLocalTiles] = useState(tiles);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const disabledRef = useRef(disabled);
  const tilesRef = useRef(tiles);
  const localTilesRef = useRef(localTiles);

  const draggingIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const lastGestureRef = useRef({ dx: 0, dy: 0 });
  const handTrayRef = useRef<View | null>(null);
  const containerOffsetRef = useRef({ x: 0, y: 0 });
  const touchOffsetRef = useRef({ x: 0, y: 0 });
  const initialTilePositionRef = useRef({ x: 0, y: 0 });

  const respondersRef = useRef<PanResponderInstance[]>([]);

  const resetDrag = useCallback(() => {
    Animated.timing(drag, {
      toValue: { x: 0, y: 0 },
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      setDraggingIndex(null);
      setHoverIndex(null);
      draggingIndexRef.current = null;
      hoverIndexRef.current = null;
      lastGestureRef.current = { dx: 0, dy: 0 };
      drag.setValue({ x: 0, y: 0 });
    });
  }, [drag]);

  const getLeftForIndex = (index: number) => {
    const totalTilesWidth =
      localTiles.length * TILE_WIDTH +
      Math.max(0, localTiles.length - 1) * TILE_GAP;

    const startX = Math.max(0, (HAND_WIDTH - totalTilesWidth) / 2);

    return startX + index * SLOT_WIDTH;
  };

  const clampIndex = useCallback(
    (index: number) =>
      Math.max(0, Math.min(localTilesRef.current.length - 1, index)),
    [],
  );

  const updateContainerOffset = useCallback(() => {
    if (!handTrayRef.current) return;

    handTrayRef.current.measureInWindow((x, y, _width, _height) => {
      containerOffsetRef.current = { x, y };
    });
  }, []);

  const startDrag = useCallback((index: number, evt: any) => {
    if (disabledRef.current) return;

    const tile = localTilesRef.current[index];

    if (tile) {
      onSelectTile?.(tile);
    }

    updateContainerOffset();

    setDraggingIndex(index);
    setHoverIndex(index);

    draggingIndexRef.current = index;
    hoverIndexRef.current = index;

    touchOffsetRef.current = {
      x: evt.nativeEvent.locationX,
      y: evt.nativeEvent.locationY,
    };

    initialTilePositionRef.current = {
      x: getLeftForIndex(index),
      y: TILE_TOP,
    };

    lastGestureRef.current = { dx: 0, dy: 0 };
    drag.setValue({ x: 0, y: 0 });
  }, [drag, onSelectTile, updateContainerOffset]);

  const finishDrag = useCallback(() => {
    if (disabledRef.current) {
      resetDrag();
      return;
    }

    const from = draggingIndexRef.current;
    const to = hoverIndexRef.current;

    if (from === null) {
      resetDrag();
      return;
    }

    const draggedLocalTile = localTilesRef.current[from];
    const shouldDropToBoard =
      lastGestureRef.current.dy <= DROP_TO_BOARD_DISTANCE;

    if (shouldDropToBoard && draggedLocalTile) {
      const realTile = tilesRef.current.find(
        (tile) => tile.id === draggedLocalTile.id,
      );

      if (realTile) {
        onPlayTile(realTile);
      }

      resetDrag();
      return;
    }

// if (to !== null && from !== to) {
//   setLocalTiles((prev) => moveTile(prev, from, to));
// }

    resetDrag();
  }, [onPlayTile, resetDrag]);

  const createResponder = useCallback(
    (index: number) =>
      PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,

      onMoveShouldSetPanResponder: (_, gesture) =>
        !disabledRef.current &&
        (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),

      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (evt) => startDrag(index, evt),

      onPanResponderMove: (evt, gesture) => {
        if (disabledRef.current) return;
        if (draggingIndexRef.current === null) return;

        lastGestureRef.current = {
          dx: gesture.dx,
          dy: gesture.dy,
        };

        const containerOffset = containerOffsetRef.current;
        const absoluteX = gesture.moveX ?? evt.nativeEvent.pageX;
        const absoluteY = gesture.moveY ?? evt.nativeEvent.pageY;

        const relativeX = absoluteX - containerOffset.x - touchOffsetRef.current.x;
        const relativeY = absoluteY - containerOffset.y - touchOffsetRef.current.y;

        drag.setValue({
          x: relativeX - initialTilePositionRef.current.x,
          y: relativeY - initialTilePositionRef.current.y,
        });

        const fromIndex = draggingIndexRef.current;
        const rawTarget =
          fromIndex + Math.floor((gesture.dx + SLOT_WIDTH / 2) / SLOT_WIDTH);

        const nextHover = clampIndex(rawTarget);

        if (nextHover !== hoverIndexRef.current) {
          hoverIndexRef.current = nextHover;
          setHoverIndex(nextHover);
        }
      },

      onPanResponderRelease: finishDrag,
      onPanResponderTerminate: finishDrag,
      onShouldBlockNativeResponder: () => true,
      }),
    [clampIndex, drag, finishDrag, startDrag],
  );

  useEffect(() => {
    disabledRef.current = disabled;

    if (disabled) {
      resetDrag();
    }
  }, [disabled, resetDrag]);

  useEffect(() => {
    tilesRef.current = tiles;
    setLocalTiles(tiles);
  }, [tiles]);

  useEffect(() => {
    localTilesRef.current = localTiles;
    respondersRef.current = localTiles.map((_, index) => createResponder(index));
  }, [localTiles, disabled, createResponder]);

      const previewTiles = localTiles;

  const draggingTileId =
    draggingIndex !== null ? localTiles[draggingIndex]?.id ?? null : null;

  return (
    <View
      ref={handTrayRef}
      onLayout={updateContainerOffset}
      style={styles.handTray}
      pointerEvents={disabled ? 'none' : 'auto'}
    >
      {previewTiles.map((tile, visualIndex) => {
        const isDragging = tile.id === draggingTileId;
        const isSelected = !disabled && tile.id === selectedTileId;
        const isPlayable = !disabled && playableTileIds.includes(tile.id);

        const panHandlers = isDragging
          ? respondersRef.current[draggingIndex ?? visualIndex]?.panHandlers ?? {}
          : respondersRef.current[visualIndex]?.panHandlers ?? {};

        return (
          <Animated.View
            key={tile.id}
            style={[
              styles.tile,
              {
                left: getLeftForIndex(visualIndex),
                zIndex: isDragging || isSelected ? 100 : isPlayable ? 50 : 1,
                opacity: disabled ? 0.45 : 1,

                shadowColor: '#000',
                shadowOpacity: 0.18,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 0 },
                elevation: 2,

                transform: isDragging
                  ? [
                      { translateX: drag.x },
                      { translateY: drag.y },
                      { scale: 1.08 },
                    ]
                  : [
                      { translateX: 0 },
                      {
                        translateY: isSelected
                          ? -6
                          : isPlayable
                            ? -10
                            : 0,
                      },
                      { scale: 1 },
                    ],
              },
            ]}
            {...panHandlers}
          >
            <DominoTile
              tile={tile}
              width={TILE_WIDTH}
              height={TILE_HEIGHT}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  handTray: {
    width: HAND_WIDTH,
    height: HAND_HEIGHT,
    position: 'relative',
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
  },

  tile: {
    position: 'absolute',
    top: TILE_TOP,
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
  },
});
