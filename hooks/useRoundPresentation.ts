import type { DominoTileData, Player, TeamId } from '@/types/game';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
  const [showGameOverPopup, setShowGameOverPopup] = useState(false);

  const winningTileKey = useMemo(() => {
    const winner = players.find((player) => player.id === roundWinnerPlayerId);
    return roundWinnerPlayerId && lastPlayedTile && winner?.tileCount === 0
      ? `${roundWinnerPlayerId}:${lastPlayedTile.id}`
      : null;
  }, [lastPlayedTile, players, roundWinnerPlayerId]);

  const isWinningTileConfirmationVisible =
    !!winningTileKey && releasedWinningTileKey !== winningTileKey;

  const finalTileAnimationTileId = isWinningTileConfirmationVisible
    ? lastPlayedTile?.id ?? null
    : null;

  const handleWinningTileAnimationComplete = useCallback(() => {
    setReleasedWinningTileKey(winningTileKey);
  }, [winningTileKey]);

  useEffect(() => {
    if (winningTeamId) {
      setShowScorePopup(false);
      setShowGameOverPopup(true);
    }
  }, [winningTeamId]);

  return {
    winningTileKey,
    isWinningTileConfirmationVisible,
    finalTileAnimationTileId,
    handleWinningTileAnimationComplete,
    showScorePopup,
    setShowScorePopup,
    showGameOverPopup,
    setShowGameOverPopup,
  };
}
