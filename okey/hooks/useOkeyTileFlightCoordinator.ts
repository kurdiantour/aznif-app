import { useState } from "react";

import type { TileFlight } from "@/okey/presentation/okey-game-presentation";

export function useOkeyTileFlightCoordinator() {
  const [tileFlight, setTileFlight] = useState<TileFlight | null>(null);
  const [hiddenRackTileIds, setHiddenRackTileIds] = useState<string[]>([]);
  const [hideDeckTopTile, setHideDeckTopTile] = useState(false);
  const [hideDiscardTopTile, setHideDiscardTopTile] = useState(false);
  const [drawFlightTileId, setDrawFlightTileId] = useState<string | null>(null);

  return {
    tileFlight,
    setTileFlight,
    hiddenRackTileIds,
    setHiddenRackTileIds,
    hideDeckTopTile,
    setHideDeckTopTile,
    hideDiscardTopTile,
    setHideDiscardTopTile,
    drawFlightTileId,
    setDrawFlightTileId,
  };
}
