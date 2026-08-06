export type RelativeSeat = "bottom" | "right" | "top" | "left";

export type RelativeSeatMap = Record<RelativeSeat, number>;

export function getRelativeSeatMap(localPlayerIndex: number): RelativeSeatMap {
  const local = ((localPlayerIndex % 4) + 4) % 4;

  return {
    bottom: local,
    right: (local + 1) % 4,
    top: (local + 2) % 4,
    left: (local + 3) % 4,
  };
}