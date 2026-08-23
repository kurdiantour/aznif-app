import type { OkeyPlayer, OkeyTile } from "@/okey/types/okey";

export function getOkeyAuthoritativeRoundPresentation({
  eligibleAt,
  serverNowMs,
  countdownSeconds,
}: {
  eligibleAt: string | null;
  serverNowMs: number;
  countdownSeconds: number;
}): {
  showFinishReveal: boolean;
  countdownRemaining: number;
  msUntilCountdown: number;
  msUntilNextCountdownTick: number;
} | null {
  const eligibleAtMs = Date.parse(eligibleAt ?? "");
  if (!Number.isFinite(eligibleAtMs) || !Number.isFinite(serverNowMs)) {
    return null;
  }

  const countdownDurationMs = Math.max(0, countdownSeconds) * 1_000;
  const countdownStartsAtMs = eligibleAtMs - countdownDurationMs;
  const remainingMs = Math.max(0, eligibleAtMs - serverNowMs);
  const countdownRemaining = Math.min(
    countdownSeconds,
    Math.ceil(remainingMs / 1_000),
  );

  return {
    showFinishReveal: serverNowMs < countdownStartsAtMs,
    countdownRemaining,
    msUntilCountdown: Math.max(0, countdownStartsAtMs - serverNowMs),
    msUntilNextCountdownTick: countdownRemaining <= 0
      ? 0
      : Math.max(
          1,
          remainingMs - (countdownRemaining - 1) * 1_000,
        ),
  };
}

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
export type LocalOkeyTurnSequenceState = {
  marker: string | null;
  sequence: number;
};

export function advanceLocalOkeyTurnSequence(
  current: LocalOkeyTurnSequenceState,
  marker: string | null,
): LocalOkeyTurnSequenceState {
  if (current.marker === marker) return current;
  return { marker, sequence: current.sequence + 1 };
}

export function getOkeyTurnIdentity({
  round,
  playerIndex,
  playerId,
  onlineDeadlineAt,
  localSequence,
}: {
  round: number;
  playerIndex: number;
  playerId: string;
  onlineDeadlineAt?: string | null;
  localSequence?: number;
}): string {
  const occurrence = onlineDeadlineAt ?? `local-${localSequence ?? 0}`;
  return `${round}-${playerIndex}-${playerId}-${occurrence}`;
}

export function getOrCreateLocalOkeyTurnDeadline(
  current: { turnIdentity: string; deadlineMs: number } | null,
  turnIdentity: string,
  now: number,
  durationMs: number,
): { turnIdentity: string; deadlineMs: number } {
  if (current?.turnIdentity === turnIdentity) return current;
  return { turnIdentity, deadlineMs: now + durationMs };
}
