import type { SeatOwnership } from "./seat-ownership.ts";

export type BotTurnClaim = { expectedVersion: number; expectedActorId: string };

export function createBotTurnClaim(input: {
  version: number;
  actorId?: string | null;
  ownership: SeatOwnership | null;
}): BotTurnClaim | null {
  if (!Number.isSafeInteger(input.version) || input.version < 0 || !input.actorId ||
      input.ownership?.ownerPlayerId !== input.actorId || input.ownership.controller !== "bot") return null;
  return { expectedVersion: input.version, expectedActorId: input.actorId };
}

export const getBotTurnClaimKey = (scopeId: string, claim: BotTurnClaim) =>
  `${scopeId}:${claim.expectedVersion}:${claim.expectedActorId}`;

export function classifyBotTurnClaim(input: {
  claim: BotTurnClaim;
  currentVersion: number;
  currentActorId: string | null;
  currentOwnership: SeatOwnership | null;
}) {
  if (input.claim.expectedVersion < input.currentVersion) return "already_processed" as const;
  if (input.claim.expectedVersion !== input.currentVersion || input.claim.expectedActorId !== input.currentActorId) return "stale" as const;
  return input.currentOwnership?.controller === "bot" ? "ready" as const : "human_controlled" as const;
}

export class BotTurnClaimRegistry {
  private readonly inFlight = new Set<string>();
  tryAcquire(scopeId: string, claim: BotTurnClaim) {
    const key = getBotTurnClaimKey(scopeId, claim);
    if (this.inFlight.has(key)) return null;
    this.inFlight.add(key);
    return key;
  }
  release(key: string) { this.inFlight.delete(key); }
}
