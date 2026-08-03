import {
  createInitialOkeyGame,
  declareKonkanOpen,
  discardTile,
  drawTile,
  lockKonkanSet,
  openPlayerMelds,
  spendTileOnMeld,
} from "../engine/okey-engine.ts";
import { resolveTimeoutTurn } from "../engine/okey-timeout.ts";
import type { OkeyGameState, OkeyMeld, OkeyTile } from "../types/okey.ts";

export const OKEY_SERVER_TURN_SECONDS = 20;

export type OkeyServerPlayerIdentity = { id: string; name: string };

function secureRandom(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] / 0x1_0000_0000;
}

export function createAuthoritativeOkeyGame(
  players: readonly [OkeyServerPlayerIdentity, OkeyServerPlayerIdentity, OkeyServerPlayerIdentity, OkeyServerPlayerIdentity],
  dealerIndex = Math.floor(secureRandom() * 4),
): OkeyGameState {
  const state = createInitialOkeyGame(dealerIndex, secureRandom);
  return {
    ...state,
    players: state.players.map((player, index) => ({
      ...player,
      id: players[index].id,
      name: players[index].name,
      kind: "human" as const,
    })),
    turnMessage: {
      code: state.hasDrawnThisTurn ? "discard-tile" : "draw-tile",
      playerName: players[state.currentPlayerIndex].name,
    },
  };
}

export type OkeyAuthoritativeCommand =
  | { type: "draw"; source: "deck" | "discard" }
  | { type: "discard"; tileId: string }
  | { type: "open-melds"; melds: OkeyMeld[]; score: number }
  | { type: "declare-konkan" }
  | { type: "spend-meld"; tileId: string; targetPlayerId: string; targetMeldId: string }
  | { type: "lock-konkan"; tileId: string; targetPlayerId: string; targetMeldId: string };

export type OkeyProjectedPlayer = Omit<OkeyGameState["players"][number], "hand"> & {
  handCount: number;
  hand?: OkeyTile[];
};

export type OkeyServerProjection = Omit<OkeyGameState, "players" | "deck"> & {
  players: OkeyProjectedPlayer[];
  deckCount: number;
  version: number;
  turnDeadlineAt: string | null;
};

export class OkeyCommandError extends Error {
  readonly code: "invalid_command" | "not_your_turn" | "command_rejected" | "deadline_expired";

  constructor(code: "invalid_command" | "not_your_turn" | "command_rejected" | "deadline_expired") {
    super(code);
    this.code = code;
  }
}

export function applyAuthoritativeOkeyCommand(
  state: OkeyGameState,
  actorPlayerIndex: number,
  command: OkeyAuthoritativeCommand,
): OkeyGameState {
  if (state.phase !== "playing") throw new OkeyCommandError("command_rejected");
  if (state.currentPlayerIndex !== actorPlayerIndex) throw new OkeyCommandError("not_your_turn");

  let next: OkeyGameState;
  switch (command.type) {
    case "draw":
      next = drawTile(state, command.source);
      break;
    case "discard":
      next = discardTile(state, command.tileId);
      break;
    case "open-melds":
      next = openPlayerMelds(state, actorPlayerIndex, command.melds, command.score);
      break;
    case "declare-konkan":
      next = declareKonkanOpen(state, actorPlayerIndex);
      break;
    case "spend-meld":
      next = spendTileOnMeld(state, actorPlayerIndex, command.tileId, command.targetPlayerId, command.targetMeldId);
      break;
    case "lock-konkan":
      next = lockKonkanSet(state, actorPlayerIndex, command.tileId, command.targetPlayerId, command.targetMeldId);
      break;
    default:
      throw new OkeyCommandError("invalid_command");
  }

  if (next === state) throw new OkeyCommandError("command_rejected");
  return next;
}

export function resolveAuthoritativeDeadline(
  state: OkeyGameState,
  deadlineAt: string | null,
  now = Date.now(),
): OkeyGameState {
  if (!deadlineAt || Date.parse(deadlineAt) > now) throw new OkeyCommandError("deadline_expired");
  const next = resolveTimeoutTurn(state, state.currentPlayerIndex);
  if (next === state) throw new OkeyCommandError("command_rejected");
  return next;
}

export function getNextOkeyTurnDeadline(state: OkeyGameState, now = Date.now()): string | null {
  return state.phase === "playing" ? new Date(now + OKEY_SERVER_TURN_SECONDS * 1000).toISOString() : null;
}

export function projectOkeyState(
  state: OkeyGameState,
  viewerPlayerIndex: number | null,
  version: number,
  turnDeadlineAt: string | null,
): OkeyServerProjection {
  const { players, deck, ...publicState } = state;
  return {
    ...publicState,
    players: players.map((player, index) => {
      const { hand, ...visiblePlayer } = player;
      return {
        ...visiblePlayer,
        handCount: hand.length,
        ...(index === viewerPlayerIndex ? { hand } : {}),
      };
    }),
    deckCount: deck.length,
    version,
    turnDeadlineAt,
  };
}

export function projectOkeyPublicState(
  state: OkeyGameState,
  version: number,
  turnDeadlineAt: string | null,
): OkeyServerProjection {
  return projectOkeyState(state, null, version, turnDeadlineAt);
}

