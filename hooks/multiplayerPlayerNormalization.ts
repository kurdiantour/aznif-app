import type { PlayerSeatPosition } from '@/types/game';

export function getPlayerIndex(
  rows: any[],
  predicate: (row: any) => boolean,
  fallback = -1,
): number {
  const row = rows.find(predicate);
  return typeof row?.player_index === 'number' ? row.player_index : fallback;
}

export function getRelativeSeat(
  playerIndex: number,
  myPlayerIndex: number,
  seatCount: 2 | 4,
): PlayerSeatPosition {
  if (seatCount === 2) return playerIndex === myPlayerIndex ? 'bottom' : 'top';

  const offset = (playerIndex - myPlayerIndex + seatCount) % seatCount;
  if (offset === 0) return 'bottom';
  if (offset === 1) return 'right';
  if (offset === 2) return 'top';
  return 'left';
}
