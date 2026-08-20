import type { DominoTileData, Player, TeamId } from '@/types/game';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const FINAL_TILE_REVEAL_DELAY_MS = 3_000;

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
  const winningTileReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (!winningTileKey) return;

    if (winningTileReleaseTimerRef.current) {
      clearTimeout(winningTileReleaseTimerRef.current);
    }

    winningTileReleaseTimerRef.current = setTimeout(() => {
      setReleasedWinningTileKey(winningTileKey);
      winningTileReleaseTimerRef.current = null;
    }, FINAL_TILE_REVEAL_DELAY_MS);
  }, [winningTileKey]);

  useEffect(() => () => {
    if (winningTileReleaseTimerRef.current) {
      clearTimeout(winningTileReleaseTimerRef.current);
    }
  }, []);

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
