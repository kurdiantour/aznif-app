import {
  declareKonkanOpen,
  discardTile,
  drawTile,
  lockKonkanSet,
  movePlayerHandTile,
  movePlayerHandTiles,
  openPlayerMelds,
  playEliminatedTurn,
  sortPlayerHand,
  spendTileOnBestMeld,
  spendTileOnMeld,
} from "@/okey/engine/okey-engine";
import type { LocalOkeyMatchAdapter } from "@/okey/adapters/okey-match-adapter";

export const localOkeyMatchAdapter: LocalOkeyMatchAdapter = {
  kind: "local",
  apply(state, command) {
    switch (command.type) {
      case "draw": return drawTile(state, command.source);
      case "discard": return discardTile(state, command.tileId);
      case "sort-hand": return sortPlayerHand(state, command.playerIndex);
      case "move-tile": return movePlayerHandTile(state, command.playerIndex, command.tileId, command.targetIndex);
      case "move-tiles": return movePlayerHandTiles(state, command.playerIndex, command.tileIds, command.targetIndex);
      case "open-melds": return openPlayerMelds(state, command.playerIndex, command.melds, command.score);
      case "declare-konkan": return declareKonkanOpen(state, command.playerIndex);
      case "spend-best": return spendTileOnBestMeld(state, command.playerIndex, command.tileId);
      case "spend-meld": return spendTileOnMeld(state, command.playerIndex, command.tileId, command.targetPlayerId, command.targetMeldId);
      case "lock-konkan": return lockKonkanSet(state, command.playerIndex, command.tileId, command.targetPlayerId, command.targetMeldId);
      case "play-eliminated": return playEliminatedTurn(state);
    }
  },
};
