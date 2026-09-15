import { chooseBotDrawSource, prepareBotTurn } from "../engine/okey-bot-engine.ts";
import { discardTile, drawTile } from "../engine/okey-engine.ts";
import type { OkeyGameState } from "../types/okey.ts";
import {
  createBotPostDrawActionEvents,
  type OkeyActionEventDraft,
} from "./okey-action-events.ts";

export type OkeyBotIntent = {
  step: "draw" | "discard";
  actorPlayerId: string;
  roundState: OkeyGameState;
  actionEvents: OkeyActionEventDraft[];
};

/**
 * Pure Bot policy/intent provider.
 *
 * It receives an already-authorized lifecycle decision and chooses the next
 * Bot transition. It performs no lifecycle evaluation, persistence, network
 * I/O, settlement, broadcast, or continuation dispatch.
 */
export function selectOkeyBotIntent(input: {
  state: OkeyGameState;
  expectedActorId: string;
  step: OkeyBotIntent["step"];
  now?: number;
}): OkeyBotIntent | null {
  const now = input.now ?? Date.now();
  const currentPlayerIndex = input.state.currentPlayerIndex;
  const currentPlayer = input.state.players[currentPlayerIndex];
  if (
    input.state.phase !== "playing" ||
    !currentPlayer ||
    currentPlayer.id !== input.expectedActorId
  ) return null;

  const botOptions = { difficulty: currentPlayer.botDifficulty ?? "normal" } as const;
  if (input.step === "draw") {
    const source = chooseBotDrawSource(input.state, botOptions);
    const roundState = drawTile(input.state, source);
    if (roundState === input.state) return null;
    return {
      step: "draw",
      actorPlayerId: currentPlayer.id,
      roundState,
      actionEvents: [{
        type: "draw",
        actorPlayerId: currentPlayer.id,
        payload: {
          source,
          ...(source === "discard"
            ? { tile: input.state.discardPile.at(-1) ?? null }
            : {}),
        },
      }],
    };
  }

  const prepared = prepareBotTurn(input.state, botOptions);
  const roundState = prepared.discardTileId
    ? discardTile(prepared.state, prepared.discardTileId)
    : prepared.state;
  if (roundState === input.state) return null;

  const discardedTile = prepared.discardTileId
    ? prepared.state.players[currentPlayerIndex]?.hand.find(
        (tile) => tile.id === prepared.discardTileId,
      ) ?? null
    : null;
  const konkanRunIds = new Set(prepared.decision.konkanRunTileIds);
  const konkanActorHand = prepared.state.players[currentPlayerIndex]?.hand ?? [];
  return {
    step: "discard",
    actorPlayerId: currentPlayer.id,
    roundState,
    actionEvents: createBotPostDrawActionEvents({
      actorPlayerId: currentPlayer.id,
      openedMelds: prepared.decision.opened
        ? prepared.state.players[currentPlayerIndex]?.melds
        : undefined,
      openedScore: prepared.state.players[currentPlayerIndex]?.scoreOpened,
      spentTileIds: prepared.decision.spentTileIds,
      declaredKonkan: prepared.decision.declaredKonkan,
      discardedTile,
      konkanRunTiles: prepared.decision.konkanRunTileIds
        .map((tileId) => konkanActorHand.find((tile) => tile.id === tileId))
        .filter((tile): tile is NonNullable<typeof tile> => !!tile),
      konkanCompletionMeldTiles: prepared.decision.declaredKonkan
        ? konkanActorHand.filter((tile) => !konkanRunIds.has(tile.id))
        : [],
    }),
  };
}
