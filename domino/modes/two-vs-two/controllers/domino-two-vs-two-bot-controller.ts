import { useEffect, useRef } from 'react';
import type { DominoTwoVsTwoAdapter } from '../adapters/domino-two-vs-two-adapter';

export function useDominoTwoVsTwoBotController(input: {
  roomId?: string;
  loading: boolean;
  currentTurnPlayerId: string;
  winningTeamId: string | null;
  roundWinnerPlayerId: string | null;
  players: any[];
  adapter: DominoTwoVsTwoAdapter | null;
}) {
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!input.roomId || input.loading || !input.adapter) return;
    if (
      !input.currentTurnPlayerId ||
      input.winningTeamId ||
      input.roundWinnerPlayerId
    ) return;
    const player = input.players.find(
      (row) => row.user_id === input.currentTurnPlayerId,
    );
    if (!player?.bot_takeover || player.connected || player.abandoned) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    void input.adapter.processBotTurn()
      .catch((error) => console.warn('process_bot_turns 2v2 failed', error))
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [
    input.roomId,
    input.loading,
    input.currentTurnPlayerId,
    input.winningTeamId,
    input.roundWinnerPlayerId,
    input.players,
    input.adapter,
  ]);
}
