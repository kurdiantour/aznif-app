import type { DominoOneVsOneAdapter } from "../adapters/domino-one-vs-one-adapter";
import { useEffect, useRef } from "react";

export function useDominoOneVsOneBotController(args: {
  roomId?: string;
  loading: boolean;
  currentTurnPlayerId: string;
  roundWinnerPlayerId: string | null;
  winningTeamId: string | null;
  players: any[];
  adapter: DominoOneVsOneAdapter | null;
  refreshSnapshot: () => Promise<unknown>;
}) {
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!args.roomId || args.loading || !args.adapter) return;
    if (!args.currentTurnPlayerId || args.winningTeamId || args.roundWinnerPlayerId) return;

    const currentTurnPlayer = args.players.find(
      (row) => row.user_id === args.currentTurnPlayerId,
    );
    if (
      !currentTurnPlayer?.bot_takeover ||
      currentTurnPlayer.connected ||
      currentTurnPlayer.abandoned ||
      inFlightRef.current
    ) return;

    inFlightRef.current = true;
    const finishBotTurn = async () => {
      try {
        // Production parity: one invocation cycle may consume up to five bot
        // actions because a bot can draw repeatedly before playing or passing.
        for (let actionCount = 0; actionCount < 5; actionCount += 1) {
          const data = await args.adapter!.processBotTurn();
          if (!data?.processed) break;
          const nextState = data.state ?? {};
          if (
            nextState.roundWinnerPlayerId ||
            nextState.winningTeamId ||
            nextState.currentTurnPlayerId !== args.currentTurnPlayerId
          ) break;
        }
      } catch (error) {
        console.warn("1v1 bot turn failed", error);
      } finally {
        inFlightRef.current = false;
        void args.refreshSnapshot().catch((error) => {
          console.warn("1v1 bot turn refresh failed", error);
        });
      }
    };

    void finishBotTurn();
  }, [
    args.roomId,
    args.loading,
    args.currentTurnPlayerId,
    args.roundWinnerPlayerId,
    args.winningTeamId,
    args.players,
    args.adapter,
    args.refreshSnapshot,
  ]);
}
