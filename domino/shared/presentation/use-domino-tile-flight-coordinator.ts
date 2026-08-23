import type { DominoTileFlight } from "./domino-tile-flight";
import { useCallback, useState } from "react";

export function useDominoTileFlightCoordinator() {
  const [flight, setFlight] = useState<DominoTileFlight | null>(null);
  const [hiddenHandTileId, setHiddenHandTileId] = useState<string | null>(null);
  const [hiddenBoardTileId, setHiddenBoardTileId] = useState<string | null>(null);

  const begin = useCallback((next: DominoTileFlight, hideFromHand: boolean) => {
    setHiddenHandTileId(hideFromHand ? next.tile.id : null);
    setHiddenBoardTileId(next.tile.id);
    setFlight(next);
  }, []);

  const hideHumanTile = useCallback((tileId: string) => {
    setHiddenHandTileId(tileId);
    setHiddenBoardTileId(tileId);
  }, []);

  const hideBoardTile = useCallback((tileId: string) => {
    setHiddenBoardTileId(tileId);
  }, []);

  const revealBoardTile = useCallback((tileId: string) => {
    setHiddenBoardTileId((current) => current === tileId ? null : current);
  }, []);

  const rollbackHumanTile = useCallback((tileId: string) => {
    setHiddenHandTileId((current) => current === tileId ? null : current);
    setHiddenBoardTileId((current) => current === tileId ? null : current);
    setFlight((current) => current?.tile.id === tileId ? null : current);
  }, []);

  const finish = useCallback(() => {
    setFlight(null);
    setHiddenBoardTileId(null);
    setHiddenHandTileId(null);
  }, []);

  const releaseHandTile = useCallback((tileId: string) => {
    setHiddenHandTileId((current) => current === tileId ? null : current);
  }, []);

  return { flight, hiddenHandTileId, hiddenBoardTileId, begin, hideHumanTile, hideBoardTile, revealBoardTile, rollbackHumanTile, finish, releaseHandTile };
}
