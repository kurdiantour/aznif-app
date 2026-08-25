import type { OkeyAuthoritativeCommand } from "./okey-authoritative.ts";
import type { OkeyMeld, OkeyTile } from "../types/okey.ts";

export type OkeyActionEventType =
  | "draw"
  | "discard"
  | "open"
  | "meld"
  | "konkan"
  | "leave"
  | "round";

export type OkeyActionEventDraft = {
  type: OkeyActionEventType;
  actorPlayerId: string | null;
  payload: Record<string, unknown>;
};

export type OkeyActionEvent = OkeyActionEventDraft & {
  matchId: string;
  version: number;
  sequence: number;
  createdAt?: string;
};

export function createOkeyCommandActionEvents(
  command: OkeyAuthoritativeCommand,
  actorPlayerId: string,
): OkeyActionEventDraft[] {
  switch (command.type) {
    case "draw":
      return [{ type: "draw", actorPlayerId, payload: { source: command.source } }];
    case "discard":
      return [{ type: "discard", actorPlayerId, payload: { tileId: command.tileId } }];
    case "open-melds":
      return [{ type: "open", actorPlayerId, payload: { melds: command.melds, score: command.score } }];
    case "open-and-discard":
      return [
        { type: "open", actorPlayerId, payload: { melds: command.melds, score: command.score } },
        { type: "discard", actorPlayerId, payload: { tileId: command.tileId } },
      ];
    case "declare-konkan":
      return [{ type: "konkan", actorPlayerId, payload: { kind: "declare", orderedRunTileIds: command.orderedRunTileIds } }];
    case "spend-meld":
      return [{ type: "meld", actorPlayerId, payload: {
        kind: "spend", tileId: command.tileId,
        targetPlayerId: command.targetPlayerId, targetMeldId: command.targetMeldId,
      } }];
    case "lock-konkan":
      return [{ type: "konkan", actorPlayerId, payload: {
        kind: "lock", tileId: command.tileId,
        targetPlayerId: command.targetPlayerId, targetMeldId: command.targetMeldId,
      } }];
  }
}

export function createForcedDrawDiscardEvents(input: {
  actorPlayerId: string;
  source: "deck" | "discard";
  tile: OkeyTile | null;
  reason: "timeout" | "eliminated";
}): OkeyActionEventDraft[] {
  return [
    { type: "draw", actorPlayerId: input.actorPlayerId, payload: { source: input.source, reason: input.reason } },
    { type: "discard", actorPlayerId: input.actorPlayerId, payload: {
      tileId: input.tile?.id ?? null, tile: input.tile, reason: input.reason,
    } },
  ];
}

export function createBotPostDrawActionEvents(input: {
  actorPlayerId: string;
  openedMelds?: OkeyMeld[];
  openedScore?: number;
  spentTileIds: string[];
  declaredKonkan: boolean;
  discardedTile: OkeyTile | null;
}): OkeyActionEventDraft[] {
  const events: OkeyActionEventDraft[] = [];
  if (input.declaredKonkan) {
    events.push({ type: "konkan", actorPlayerId: input.actorPlayerId, payload: { kind: "declare" } });
  }
  if (input.openedMelds?.length) {
    events.push({ type: "open", actorPlayerId: input.actorPlayerId, payload: {
      melds: input.openedMelds, score: input.openedScore ?? 0,
    } });
  }
  for (const tileId of input.spentTileIds) {
    events.push({ type: "meld", actorPlayerId: input.actorPlayerId, payload: { kind: "spend", tileId } });
  }
  if (input.discardedTile) {
    events.push({ type: "discard", actorPlayerId: input.actorPlayerId, payload: {
      tileId: input.discardedTile.id, tile: input.discardedTile,
    } });
  }
  return events;
}