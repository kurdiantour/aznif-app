export const POINTS_PER_LEVEL = 150;
export const MAX_LEVEL = 5;

const RANK_TITLES = ['فێرخواز', 'شارەزا', 'مامۆستا', 'پاڵەوان', 'ئەفسانە'] as const;

export function calculateLevelFromPoints(points?: number | null) {
  const safePoints = Math.max(0, Number(points ?? 0));

  return Math.min(MAX_LEVEL, Math.floor(safePoints / POINTS_PER_LEVEL) + 1);
}

export function getRankTitleFromLevel(level?: number | null) {
  const parsedLevel = Number(level ?? 1);
  const safeLevel = Number.isFinite(parsedLevel)
    ? Math.min(MAX_LEVEL, Math.max(1, Math.floor(parsedLevel)))
    : 1;

  return RANK_TITLES[safeLevel - 1];
}
