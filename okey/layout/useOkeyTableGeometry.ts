import { useCallback, useRef } from "react";
import type { View } from "react-native";

import type { MeldDropRect, ScreenRect } from "@/okey/presentation/okey-game-presentation";
import { findClosestMeldDropTarget, isPointInsideRect, toLocalScreenRect } from "@/okey/presentation/okey-table-interactions";

const EMPTY_RECT: ScreenRect = { x: 0, y: 0, width: 0, height: 0 };
const DISCARD_DROP_PADDING = 26;

/** Single registry for every screen-space measurement used by the Okey table. */
export function useOkeyTableGeometry() {
  const screenRef = useRef<View | null>(null);
  const screenRectRef = useRef<ScreenRect>({ ...EMPTY_RECT });
  const deckTopRectRef = useRef<ScreenRect | null>(null);
  const discardTopRectRef = useRef<ScreenRect | null>(null);
  const opponentSeatRectsRef = useRef<Record<string, ScreenRect>>({});
  const rackRectRef = useRef<ScreenRect | null>(null);
  const rackTileRectsRef = useRef<Record<string, ScreenRect>>({});
  const drawLandingRectRef = useRef<ScreenRect | null>(null);
  const meldDropRectsRef = useRef<MeldDropRect[]>([]);
  const hoveredMeldTargetRef = useRef<MeldDropRect | null>(null);
  const humanMeldDropZoneRef = useRef<View | null>(null);

  const measureScreen = useCallback(() => {
    screenRef.current?.measureInWindow((x, y, width, height) => {
      screenRectRef.current = { x, y, width, height };
    });
  }, []);
  const measureHumanMeldDropZone = useCallback(() => {
    humanMeldDropZoneRef.current?.measureInWindow((x, y, width, height) => {
      const rect = { x, y, width, height };

      humanDropRectRef.current = rect;
    });
  }, []);
  const humanDropRectRef = useRef<ScreenRect>({ ...EMPTY_RECT });
  const toLocalRect = useCallback(
    (rect: ScreenRect) => toLocalScreenRect(rect, screenRectRef.current),
    [],
  );
  const isInsideRack = useCallback((point: { x: number; y: number }) => {
    const rect = rackRectRef.current;
    return rect ? isPointInsideRect(point, rect) : false;
  }, []);
  const isInsideDiscardPile = useCallback((point: { x: number; y: number }) => {
    const rect = discardTopRectRef.current;
    return rect ? isPointInsideRect(point, {
      x: rect.x - DISCARD_DROP_PADDING,
      y: rect.y - DISCARD_DROP_PADDING,
      width: rect.width + DISCARD_DROP_PADDING * 2,
      height: rect.height + DISCARD_DROP_PADDING * 2,
    }) : false;
  }, []);
  const isInsideHumanMeldZone = useCallback((
    point: { x: number; y: number },
    blocked: boolean,
  ) => {
    const table = screenRectRef.current;
    if (blocked || table.width <= 0 || table.height <= 0) return false;
    const forbidden = [rackRectRef.current, deckTopRectRef.current, discardTopRectRef.current];
    return !forbidden.some((rect) => rect && isPointInsideRect(point, rect)) && isPointInsideRect(point, table);
  }, []);
  const registerMeldDropRect = useCallback((playerId: string, meldId: string, rect: ScreenRect) => {
    meldDropRectsRef.current = [
      ...meldDropRectsRef.current.filter((entry) => entry.playerId !== playerId || entry.meldId !== meldId),
      { playerId, meldId, ...rect },
    ];
  }, []);
  const findMeldDropTarget = useCallback((
    point: { x: number; y: number },
    isValid: (rect: MeldDropRect) => boolean,
  ) => findClosestMeldDropTarget(meldDropRectsRef.current, point, isValid), []);
  const setOpponentSeatRect = useCallback((playerId: string | undefined, rect: ScreenRect) => {
    if (playerId) opponentSeatRectsRef.current[playerId] = rect;
  }, []);
  const clearRoundGeometry = useCallback(() => {
    meldDropRectsRef.current = [];
    hoveredMeldTargetRef.current = null;
    rackTileRectsRef.current = {};
  }, []);

  return {
    screenRef,
    screenRectRef,
    deckTopRectRef,
    discardTopRectRef,
    opponentSeatRectsRef,
    rackRectRef,
    rackTileRectsRef,
    drawLandingRectRef,
    meldDropRectsRef,
    hoveredMeldTargetRef,
    humanMeldDropZoneRef,
    measureScreen,
    measureHumanMeldDropZone,
    toLocalRect,
    isInsideRack,
    isInsideDiscardPile,
    isInsideHumanMeldZone,
    registerMeldDropRect,
    findMeldDropTarget,
    setOpponentSeatRect,
    clearRoundGeometry,
  };
}
