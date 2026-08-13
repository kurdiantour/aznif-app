import type { OkeyPlayer, OkeyTile } from "@/okey/types/okey";

export function createOkeyMeldPresentationFrames(
  presentedPlayers: OkeyPlayer[],
  targetPlayers: OkeyPlayer[],
): OkeyPlayer[][] {
  let current = targetPlayers.map((player) => ({
    ...player,
    melds: presentedPlayers.find((entry) => entry.id === player.id)?.melds ?? [],
  }));
  const frames: OkeyPlayer[][] = [];

  const commitPlayerMelds = (playerIndex: number, melds: OkeyPlayer["melds"]) => {
    current = current.map((player, index) =>
      index === playerIndex ? { ...player, melds } : player,
    );
    frames.push(current);
  };

  targetPlayers.forEach((targetPlayer, playerIndex) => {
    for (const targetMeld of targetPlayer.melds) {
      const currentMeldIndex = current[playerIndex]?.melds.findIndex((meld) => meld.id === targetMeld.id) ?? -1;
      if (currentMeldIndex < 0) {
        commitPlayerMelds(playerIndex, [...(current[playerIndex]?.melds ?? []), targetMeld]);
        continue;
      }

      const currentMeld = current[playerIndex].melds[currentMeldIndex];
      const currentIds = new Set(currentMeld.tiles.map((tile) => tile.id));
      const addedTiles = targetMeld.tiles.filter((tile) => !currentIds.has(tile.id));
      if (addedTiles.length > 0) {
        for (const addedTile of addedTiles) {
          currentIds.add(addedTile.id);
          const nextMeld = {
            ...targetMeld,
            tiles: targetMeld.tiles.filter((tile) => currentIds.has(tile.id)),
          };
          commitPlayerMelds(
            playerIndex,
            current[playerIndex].melds.map((meld, index) => index === currentMeldIndex ? nextMeld : meld),
          );
        }
        continue;
      }

      if (JSON.stringify(currentMeld) !== JSON.stringify(targetMeld)) {
        commitPlayerMelds(
          playerIndex,
          current[playerIndex].melds.map((meld, index) => index === currentMeldIndex ? targetMeld : meld),
        );
      }
    }

    if (JSON.stringify(current[playerIndex].melds) !== JSON.stringify(targetPlayer.melds)) {
      commitPlayerMelds(playerIndex, targetPlayer.melds);
    }
  });

  return frames;
}

export function isOkeyTurnPresentationBlocked({
  opponentTransitionActive,
  hasUnpresentedOpponentDiscard,
  hasTileFlight,
  hasPendingHumanHandRemoval = false,
}: {
  opponentTransitionActive: boolean;
  hasUnpresentedOpponentDiscard: boolean;
  hasTileFlight: boolean;
  hasPendingHumanHandRemoval?: boolean;
}) {
  return opponentTransitionActive || hasUnpresentedOpponentDiscard || hasTileFlight || hasPendingHumanHandRemoval;
}
export type ScreenRect = { x: number; y: number; width: number; height: number };
export type TileFlight = { id: string; tile: OkeyTile | null; face: "front" | "back"; from: ScreenRect; to: ScreenRect };
export type QueuedOpponentDiscardFlight = { tile: OkeyTile; ownerPlayerId: string; discardCount: number; animateWallDraw?: boolean };
export type EliminatedTurnFlight = {
  playerIndex: number;
  playerId: string;
  tile: OkeyTile;
  stage: "draw" | "discard" | "committing";
  playerRect: ScreenRect;
  discardRect: ScreenRect;
};
export type MeldDropRect = { playerId: string; meldId: string; x: number; y: number; width: number; height: number };
export type MeldOffset = { x: number; y: number };
