import type { DominoOneVsOneAdapter } from "../adapters/domino-one-vs-one-adapter";
import { useCallback, useEffect, useRef } from "react";

export function useDominoOneVsOneRoundSync(args: {
  roomId?: string;
  adapter: DominoOneVsOneAdapter | null;
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
    if (!args.roomId || !args.adapter) return;
    clearSync();
    try {
      const snapshot = await args.adapter.startGame();
      args.applySnapshot(snapshot);
    } catch (error) {
      console.warn("1v1 start game failed", error);
    }
  }, [args.roomId, args.adapter, args.applySnapshot, clearSync]);

  useEffect(() => {
    if (args.hasAuthoritativeActiveHand) {
      clearSync();
      return;
    }
    if (!args.roundWinnerPlayerId || args.winningTeamId || args.status === "finished") {
      clearSync();
      return;
    }

    intervalRef.current = setInterval(() => {
      void args.refreshSnapshot().catch((error) => {
        console.warn("1v1 round transition sync failed", error);
      });
    }, args.syncIntervalMs);

    return clearSync;
  }, [
    args.refreshSnapshot,
    args.status,
    args.roundWinnerPlayerId,
    args.winningTeamId,
    args.syncIntervalMs,
    args.hasAuthoritativeActiveHand,
    clearSync,
  ]);

  return { startNextRound, stopSync: clearSync };
}
