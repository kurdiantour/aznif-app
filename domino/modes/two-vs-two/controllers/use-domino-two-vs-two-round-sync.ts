import type { DominoTwoVsTwoAdapter } from '../adapters/domino-two-vs-two-adapter';
import { useCallback, useEffect, useRef } from 'react';

export function useDominoTwoVsTwoRoundSync(args: {
  roomId?: string;
  adapter: DominoTwoVsTwoAdapter | null;
  completedRoundId: string | null;
  roundWinnerPlayerId: string | null;
  winningTeamId: string | null;
  status: unknown;
  hasAuthoritativeActiveHand: boolean;
  syncIntervalMs: number;
  applySnapshot: (snapshot: unknown) => boolean;
  refreshSnapshot: () => Promise<unknown>;
}) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearSync = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  const startNextRound = useCallback(async () => {
    if (!args.roomId || !args.adapter || !args.completedRoundId) return;
    clearSync();
    try {
      const snapshot = await args.adapter.startNextHand(args.completedRoundId);
      args.applySnapshot(snapshot);
    } catch (error) {
      console.warn('2v2 start next hand failed', error);
      await args.refreshSnapshot().catch(() => undefined);
    }
  }, [
    args.roomId,
    args.adapter,
    args.completedRoundId,
    args.applySnapshot,
    args.refreshSnapshot,
    clearSync,
  ]);

  useEffect(() => {
    if (args.hasAuthoritativeActiveHand) {
      clearSync();
      return;
    }
    if (!args.roundWinnerPlayerId || args.winningTeamId || args.status === 'finished') {
      clearSync();
      return;
    }

    intervalRef.current = setInterval(() => {
      void args.refreshSnapshot().catch((error) => {
        console.warn('2v2 round transition sync failed', error);
      });
    }, args.syncIntervalMs);

    return clearSync;
  }, [
    args.hasAuthoritativeActiveHand,
    args.refreshSnapshot,
    args.status,
    args.roundWinnerPlayerId,
    args.winningTeamId,
    args.syncIntervalMs,
    clearSync,
  ]);

  return { startNextRound };
}
