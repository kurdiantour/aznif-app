import type { DominoTileData, Player, TeamId } from '@/types/game';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useRoundPresentation({
  players,
  roundWinnerPlayerId,
  lastPlayedTile,
  winningTeamId,
}: {
  players: Player[];
  roundWinnerPlayerId: string | null;
  lastPlayedTile: DominoTileData | null;
  winningTeamId: TeamId | null;
}) {
  const [releasedWinningTileKey, setReleasedWinningTileKey] = useState<string | null>(null);
  const [showScorePopup, setShowScorePopup] = useState(false);
  const winningTileHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const winningTileKey = useMemo(() => {
    const winner = players.find((player) => player.id === roundWinnerPlayerId);
    return roundWinnerPlayerId && lastPlayedTile && winner?.tileCount === 0
      ? `${roundWinnerPlayerId}:${lastPlayedTile.id}`
      : null;
  }, [lastPlayedTile, players, roundWinnerPlayerId]);

  const isWinningTileConfirmationVisible =
    !!winningTileKey && releasedWinningTileKey !== winningTileKey;

  const handleWinningTileAnimationComplete = useCallback((animationKey: string) => {
    if (winningTileHoldTimerRef.current) clearTimeout(winningTileHoldTimerRef.current);
    winningTileHoldTimerRef.current = setTimeout(() => {
      setReleasedWinningTileKey(animationKey);
      winningTileHoldTimerRef.current = null;
    }, 1000);
  }, []);

  useEffect(() => {
    if (winningTeamId) setShowScorePopup(false);
  }, [winningTeamId]);

  useEffect(() => () => {
    if (winningTileHoldTimerRef.current) clearTimeout(winningTileHoldTimerRef.current);
  }, []);

  return {
    winningTileKey,
    isWinningTileConfirmationVisible,
    handleWinningTileAnimationComplete,
    showScorePopup,
    setShowScorePopup,
    showGameOverPopup: !!winningTeamId,
  };
}
