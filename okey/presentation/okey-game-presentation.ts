import type { OkeyTile } from "@/okey/types/okey";

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

export type ScreenRect = { x: number; y: number; width: number; height: number };
export type TileFlight = { id: string; tile: OkeyTile | null; face: "front" | "back"; from: ScreenRect; to: ScreenRect };
export type QueuedOpponentDiscardFlight = { tile: OkeyTile; ownerPlayerId: string; discardCount: number; animateWallDraw?: boolean };
export type MeldDropRect = { playerId: string; meldId: string; x: number; y: number; width: number; height: number };
export type MeldOffset = { x: number; y: number };

