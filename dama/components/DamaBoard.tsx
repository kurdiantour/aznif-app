import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { BOARD_CELLS, BOARD_CELL_SIZE, BOARD_GRID_OFFSET, BOARD_IMAGE_SIZE, orientSquare, squareAtBoardPoint, type BoardPerspective } from '../board-layout';
import type { Piece, Square } from '../engine';
import { DamaPiece } from './DamaPiece';

type Props = {
  pieces: readonly Piece[];
  selectedId: string | null;
  forcedMovePieceIds?: readonly string[];
  capturePieceIds?: readonly string[];
  targets: readonly Square[];
  onSquarePress: (square: Square) => void;
  onSquareDrag: (from: Square, to: Square) => void;
  perspective?: BoardPerspective;
  botStep?: BotStepAnimation | null;
};

type BoardCellProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: Piece['color'] | null;
  king: boolean;
  selected: boolean;
  forcedMove: boolean;
  capturePiece: boolean;
  target: boolean;
  hidePiece: boolean;
};

const BoardCell = memo(function BoardCell({ x, y, width, height, color, king, selected, forcedMove, capturePiece, target, hidePiece }: BoardCellProps) {
  return (
    <View pointerEvents="none" style={[styles.cell, { left: x, top: y, width, height }]}>
      {target && <View style={[styles.target, { width: width * 0.38, height: height * 0.38, borderRadius: width * 0.19 }]} />}
      {forcedMove && !selected && <View style={[styles.forcedMove, { width: width * 0.96, height: height * 0.96, borderRadius: width * 0.48 }]} />}
      {capturePiece && <View style={[styles.capturePiece, { width: width * 0.96, height: height * 0.96, borderRadius: width * 0.48 }]} />}
      {selected && <View style={[styles.selected, { width: width * 0.93, height: height * 0.93, borderRadius: width * 0.47 }]} />}
      {color && !hidePiece && <DamaPiece color={color} width={width * 0.88} height={height * 0.88} />}
      {color && king && !hidePiece && <Text style={[styles.king, { fontSize: width * 0.44 }]}>★</Text>}
    </View>
  );
}, (previous, next) => previous.x === next.x && previous.y === next.y &&
  previous.width === next.width && previous.height === next.height &&
  previous.color === next.color && previous.king === next.king &&
  previous.selected === next.selected && previous.forcedMove === next.forcedMove &&
  previous.capturePiece === next.capturePiece && previous.target === next.target &&
  previous.hidePiece === next.hidePiece);

export type BotStepAnimation = {
  key: string;
  piece: Piece;
  from: Square;
  to: Square;
  onComplete: () => void;
};

function AnimatedBotPiece({ step, scale }: { step: BotStepAnimation; scale: number }) {
  const [travel] = useState(() => new Animated.Value(0));
  const { onComplete } = step;
  const cellSize = BOARD_CELL_SIZE * scale;

  useEffect(() => {
    const motion = Animated.timing(travel, {
      toValue: 1,
      duration: 460,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    motion.start(({ finished }) => { if (finished) onComplete(); });
    return () => motion.stop();
  }, [travel, onComplete]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.cell, {
        left: (BOARD_GRID_OFFSET + step.from.column * BOARD_CELL_SIZE) * scale,
        top: (BOARD_GRID_OFFSET + step.from.row * BOARD_CELL_SIZE) * scale,
        width: cellSize,
        height: cellSize,
        transform: [
          { translateX: travel.interpolate({ inputRange: [0, 1], outputRange: [0, (step.to.column - step.from.column) * cellSize] }) },
          { translateY: travel.interpolate({ inputRange: [0, 1], outputRange: [0, (step.to.row - step.from.row) * cellSize] }) },
        ],
      }]}
    >
      <DamaPiece color={step.piece.color} width={cellSize * 0.88} height={cellSize * 0.88} />
      {step.piece.king && <Text style={[styles.king, { fontSize: cellSize * 0.44 }]}>★</Text>}
    </Animated.View>
  );
}

export const DamaBoard = memo(function DamaBoard({ pieces, selectedId, forcedMovePieceIds = [], capturePieceIds = [], targets, onSquarePress, onSquareDrag, perspective = 'cream', botStep }: Props) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const scale = Math.min(layout.width, layout.height) / BOARD_IMAGE_SIZE.width;
  const start = useRef({ x: 0, y: 0 });
  // Runtime snapshots can briefly be incomplete even though the public prop
  // type is an array. Keep a transient bad payload from crashing the board.
  const safePieces = Array.isArray(pieces) ? pieces : [];
  const safeTargets = Array.isArray(targets) ? targets : [];

  const bySquare = useMemo(() => new Map(safePieces.map((piece) => {
    const display = orientSquare(piece, perspective);
    return [`${display.row}-${display.column}`, piece] as const;
  })), [safePieces, perspective]);
  const displayBotStep = botStep ? {
    ...botStep,
    from: orientSquare(botStep.from, perspective),
    to: orientSquare(botStep.to, perspective),
  } : null;
  const targetSquares = useMemo(() => new Set(safeTargets.map((target) => {
    const display = orientSquare(target, perspective);
    return `${display.row}-${display.column}`;
  })), [perspective, safeTargets]);
  const forcedMoveIds = useMemo(() => new Set(forcedMovePieceIds), [forcedMovePieceIds]);
  const captureIds = useMemo(() => new Set(capturePieceIds), [capturePieceIds]);

  return (
    <View
      accessibilityLabel="Dama board, eight by eight"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setLayout((current) => current.width === width && current.height === height
          ? current
          : { width, height });
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        start.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
      }}
      onResponderRelease={(event) => {
        const point = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
        const to = squareAtBoardPoint(point.x, point.y, layout.width);
        if (!to) return;
        const logicalTo = orientSquare(to, perspective);
        const dragged = Math.hypot(point.x - start.current.x, point.y - start.current.y) > 12;
        if (dragged) {
          const from = squareAtBoardPoint(start.current.x, start.current.y, layout.width);
          if (from) onSquareDrag(orientSquare(from, perspective), logicalTo);
        }
        else onSquarePress(logicalTo);
      }}
    >
      {BOARD_CELLS.map((cell) => {
        const piece = bySquare.get(`${cell.row}-${cell.column}`);
        const width = cell.width * scale;
        const height = cell.height * scale;
        return (
          <BoardCell
            key={`${cell.row}-${cell.column}`}
            x={cell.x * scale}
            y={cell.y * scale}
            width={width}
            height={height}
            color={piece?.color ?? null}
            king={piece?.king ?? false}
            selected={piece?.id === selectedId}
            forcedMove={!!piece && forcedMoveIds.has(piece.id)}
            capturePiece={!!piece && captureIds.has(piece.id)}
            target={targetSquares.has(`${cell.row}-${cell.column}`)}
            hidePiece={piece?.id === botStep?.piece.id}
          />
        );
      })}
      {displayBotStep && <AnimatedBotPiece key={displayBotStep.key} step={displayBotStep} scale={scale} />}
    </View>
  );
});

const styles = StyleSheet.create({
  cell: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  target: { position: 'absolute', backgroundColor: 'rgba(255,218,89,0.62)', borderWidth: 2, borderColor: '#fff2b1' },
  forcedMove: { position: 'absolute', borderWidth: 3, borderColor: '#70f0a0', backgroundColor: 'rgba(40,220,110,0.16)' },
  capturePiece: { position: 'absolute', borderWidth: 3, borderColor: '#ff6262', backgroundColor: 'rgba(255,55,55,0.18)' },
  selected: { position: 'absolute', borderWidth: 3, borderColor: '#ffe16f', backgroundColor: 'rgba(255,220,100,0.2)' },
  king: { position: 'absolute', color: '#ffd66e', textShadowColor: '#311506', textShadowRadius: 3, fontWeight: '900' },
});
