import type { OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";
import type { OkeyGameState, OkeyTile } from "@/okey/types/okey";

const placeholder = (id: string): OkeyTile => ({ id, color: "black", value: 0, copy: 1 });

export function projectOkeyServerState(
  projection: OkeyMatchServerProjection,
  currentUserId: string | null,
): OkeyGameState {
  const count = projection.players.length;
  // Viewer identity remains the authenticated user after terminal projections
  // deliberately stop exposing a private hand.
  const viewer = currentUserId
    ? projection.players.findIndex((player) => player.id === currentUserId)
    : -1;
  const normalize = (index: number) => viewer < 0 ? index : (index - viewer + count) % count;
  const projectedPlayers = projection.players.map((player) => ({
    ...player,
    hand: projection.phase !== "playing" ? [] : Array.isArray(player.hand)
      ? player.hand
      : [],
    firstOpenScore: player.firstOpenScore ?? null,
    pendingKonkanFromDiscard: player.pendingKonkanFromDiscard ?? false,
  }));
  const players = viewer > 0
    ? [...projectedPlayers.slice(viewer), ...projectedPlayers.slice(0, viewer)]
    : projectedPlayers;
  return {
    players,
    stagingMelds: projection.stagingMelds,
    teamFirstOpenScores: projection.teamFirstOpenScores,
    currentPlayerIndex: normalize(projection.currentPlayerIndex),
    dealerIndex: normalize(projection.dealerIndex),
    deck: projection.phase === "playing"
      ? Array.from({ length: projection.deckCount }, (_, index) => placeholder(`deck-placeholder-${index}`)) : [],
    discardPile: projection.discardPile,
    discardOwners: projection.discardOwners.flatMap((owner) => {
      if (!owner) return [];
      const playerId = owner.playerId ?? projection.players[owner.playerIndex]?.id;
      return playerId ? [{ playerId, playerIndex: normalize(owner.playerIndex) }] : [];
    }),
    konkanDiscardPickCounts: projection.konkanDiscardPickCounts,
    mustFinishAfterSecondKonkanDiscardPickPlayerId: projection.mustFinishAfterSecondKonkanDiscardPickPlayerId,
    reshuffleCount: projection.reshuffleCount,
    indicatorTile: projection.indicatorTile,
    okeyTile: projection.okeyTile,
    phase: projection.phase,
    winnerId: projection.winnerId,
    endReason: projection.endReason,
    turnMessage: projection.turnMessage,
    hasDrawnThisTurn: projection.hasDrawnThisTurn,
  };
}
