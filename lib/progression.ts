export const POINTS_PER_LEVEL = 150;
export const MAX_LEVEL = 7;

const RANK_TITLES = [
  "فێرخواز",
  "ئەندام",
  "شارەزا",
  "لێهاتوو",
  "ئەستێرە",
  "پاڵەوان",
  "ئەفسانە",
] as const;

export function calculateLevelFromPoints(points?: number | null) {
  const safePoints = Math.max(points ?? 0, 0);

  return Math.min(MAX_LEVEL, Math.floor(safePoints / POINTS_PER_LEVEL) + 1);
}

export function getRankTitleFromLevel(level?: number | null) {
  const parsedLevel = Number(level ?? 1);
  const safeLevel = Number.isFinite(parsedLevel)
    ? Math.min(MAX_LEVEL, Math.max(1, Math.floor(parsedLevel)))
    : 1;

  return RANK_TITLES[safeLevel - 1];
}

export function getRankTitleFromPoints(points?: number | null) {
  return getRankTitleFromLevel(calculateLevelFromPoints(points));
}
