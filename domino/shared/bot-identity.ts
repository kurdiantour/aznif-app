import type { AvatarId } from '../../types/avatar.ts';

export type DominoBotIdentity = {
  number: number;
  name: string;
  avatarId: AvatarId;
  avatarUrl?: string;
};

export type DominoBotIdentitySeat = {
  id: string;
  playerIndex: number;
};

const MIN_BOT_NUMBER = 300;
const BOT_NUMBER_COUNT = 700;
const MAX_BOT_NUMBER = MIN_BOT_NUMBER + BOT_NUMBER_COUNT - 1;

function hashBotIdentity(seed: string): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/**
 * Assigns stable, match-local Domino bot identities in seat order.
 * The formula intentionally matches Okey's proven 300-999 identity policy,
 * while ownership remains entirely inside Domino.
 */
export function assignDominoBotIdentities(
  seats: readonly DominoBotIdentitySeat[],
): ReadonlyMap<string, DominoBotIdentity> {
  const identities = new Map<string, DominoBotIdentity>();
  const used = new Set<number>();

  const orderedSeats = [...seats].sort(
    (left, right) =>
      left.playerIndex - right.playerIndex ||
      left.id.localeCompare(right.id),
  );

  for (const seat of orderedSeats) {
    const seed = `${seat.id}:${seat.playerIndex}`;

    let candidate =
      MIN_BOT_NUMBER + (hashBotIdentity(seed) % BOT_NUMBER_COUNT);

    while (used.has(candidate)) {
      candidate =
        candidate >= MAX_BOT_NUMBER
          ? MIN_BOT_NUMBER
          : candidate + 1;
    }

    used.add(candidate);

    identities.set(seat.id, {
      number: candidate,
      name: `Bot ${candidate}`,
      avatarId: 'bot-avatar',
      avatarUrl: undefined,
    });
  }

  return identities;
}