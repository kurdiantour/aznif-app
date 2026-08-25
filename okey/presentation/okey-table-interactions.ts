import type {
  MeldDropRect,
  ScreenRect,
} from "@/okey/presentation/okey-game-presentation";

export type ScreenPoint = { x: number; y: number };

export function toLocalScreenRect(rect: ScreenRect, screenRect: ScreenRect): ScreenRect {
  return { ...rect, x: rect.x - screenRect.x, y: rect.y - screenRect.y };
}


export function isPointInsideRect(point: ScreenPoint, rect: ScreenRect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function findClosestMeldDropTarget(
  rects: MeldDropRect[],
  point: ScreenPoint,
  isValid: (rect: MeldDropRect) => boolean,
  snapDistance = 120,
) {
  return rects
    .map((rect) => {
      const distanceX = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
      const distanceY = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
      return { rect, distance: Math.hypot(distanceX, distanceY) };
    })
    .filter((entry) => entry.distance <= snapDistance)
    .sort((left, right) => left.distance - right.distance)
    .find(({ rect }) => isValid(rect))?.rect ?? null;
}