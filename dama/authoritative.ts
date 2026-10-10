import {
  applyMove,
  createGame,
  DAMA_TURN_DURATION_MS,
  getLegalMoves,
  isTurnExpired,
  resolveTurnTimeout,
  type GameState,
  type Move,
  type Side,
} from "./engine.ts";

export type DamaPlayerSeat = {
  playerId: string;
  connected: boolean;
  lastSeenAtMs: number;
};

export type DamaMatchState = {
  matchId: string;
  version: number;
  game: GameState;
  turnId: string;
  players: Record<Side, DamaPlayerSeat | null>;
  createdAtMs: number;
  updatedAtMs: number;
};

export type DamaMoveCommand = {
  matchId: string;
  actorPlayerId: string;
  playerColor: Side;
  expectedVersion: number;
  expectedTurnId: string;
  move: Move;
};

export type DamaRoomPlayer = {
  playerId: string;
  color: Side;
  connected: boolean;
  lastSeenAtMs: number;
};

export type DamaRoomState = {
  roomId: string;
  match: DamaMatchState;
  players: Record<Side, DamaRoomPlayer | null>;
  createdAtMs: number;
  updatedAtMs: number;
};

export type DamaCommandOutcome =
  | {
      accepted: true;
      state: DamaMatchState;
      appliedMove: Move;
      reason: "move_accepted";
    }
  | {
      accepted: false;
      reason:
        | "stale_state_version"
        | "stale_turn"
        | "wrong_turn"
        | "player_missing"
        | "turn_expired"
        | "illegal_move";
      matchId: string;
      stateVersion: number;
      turnId: string;
    };

export function createDamaTurnId(
  matchId: string,
  turn: Side,
  version: number,
  nowMs: number,
): string {
  return `${matchId}:${turn}:${version}:${nowMs}`;
}

export function createDamaMatchState(
  matchId: string,
  game: GameState = createGame(),
  players: Partial<Record<Side, DamaPlayerSeat | null>> = {},
  nowMs = Date.now(),
): DamaMatchState {
  return {
    matchId,
    version: 0,
    game,
    turnId: createDamaTurnId(matchId, game.turn, 0, nowMs),
    players: {
      cream: players.cream ?? null,
      black: players.black ?? null,
    },
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

function getPlayerSeatForColor(
  match: DamaMatchState,
  color: Side,
): DamaPlayerSeat | null {
  return match.players[color];
}

export function resolveDamaMoveCommand(
  match: DamaMatchState,
  command: DamaMoveCommand,
  nowMs = Date.now(),
): DamaCommandOutcome {
  if (command.matchId !== match.matchId) {
    return {
      accepted: false,
      reason: "stale_state_version",
      matchId: match.matchId,
      stateVersion: match.version,
      turnId: match.turnId,
    };
  }

  if (command.expectedVersion !== match.version) {
    return {
      accepted: false,
      reason: "stale_state_version",
      matchId: match.matchId,
      stateVersion: match.version,
      turnId: match.turnId,
    };
  }

  if (command.expectedTurnId !== match.turnId) {
    return {
      accepted: false,
      reason: "stale_turn",
      matchId: match.matchId,
      stateVersion: match.version,
      turnId: match.turnId,
    };
  }

  if (command.playerColor !== match.game.turn) {
    return {
      accepted: false,
      reason: "wrong_turn",
      matchId: match.matchId,
      stateVersion: match.version,
      turnId: match.turnId,
    };
  }

  const seat = getPlayerSeatForColor(match, command.playerColor);
  if (!seat || seat.playerId !== command.actorPlayerId) {
    return {
      accepted: false,
      reason: "player_missing",
      matchId: match.matchId,
      stateVersion: match.version,
      turnId: match.turnId,
    };
  }

  if (isTurnExpired(match.game, nowMs)) {
    return {
      accepted: false,
      reason: "turn_expired",
      matchId: match.matchId,
      stateVersion: match.version,
      turnId: match.turnId,
    };
  }

  const legal = getLegalMoves(match.game).find(
    (candidate) =>
      candidate.pieceId === command.move.pieceId &&
      JSON.stringify(candidate.steps) === JSON.stringify(command.move.steps),
  );

  if (!legal) {
    return {
      accepted: false,
      reason: "illegal_move",
      matchId: match.matchId,
      stateVersion: match.version,
      turnId: match.turnId,
    };
  }

  const nextGame = applyMove(match.game, legal, nowMs);
  const nextVersion = match.version + 1;
  const nextTurnId = createDamaTurnId(match.matchId, nextGame.turn, nextVersion, nowMs);

  const nextState: DamaMatchState = {
    ...match,
    version: nextVersion,
    game: nextGame,
    turnId: nextTurnId,
    updatedAtMs: nowMs,
  };

  return {
    accepted: true,
    state: nextState,
    appliedMove: legal,
    reason: "move_accepted",
  };
}

export function resolveDamaTurnTimeout(
  match: DamaMatchState,
  nowMs = Date.now(),
): DamaMatchState {
  const nextGame = resolveTurnTimeout(match.game, nowMs);
  const nextVersion = match.version + 1;
  const nextTurnId = createDamaTurnId(match.matchId, nextGame.turn, nextVersion, nowMs);

  return {
    ...match,
    version: nextVersion,
    game: nextGame,
    turnId: nextTurnId,
    updatedAtMs: nowMs,
  };
}

export function getDamaTurnSnapshot(match: DamaMatchState, nowMs = Date.now()) {
  return {
    matchId: match.matchId,
    version: match.version,
    turnId: match.turnId,
    turn: match.game.turn,
    stateDeadlineAtMs: match.game.turnDeadlineAtMs ?? null,
    remainingMs:
      match.game.turnDeadlineAtMs == null
        ? 0
        : Math.max(0, match.game.turnDeadlineAtMs - nowMs),
    totalTurnMs: DAMA_TURN_DURATION_MS,
    expired: isTurnExpired(match.game, nowMs),
  };
}

export function createDamaRoom(
  roomId: string,
  playerIds: Partial<Record<Side, string | null>> = {},
  nowMs = Date.now(),
): DamaRoomState {
  const match = createDamaMatchState(
    `${roomId}:match`,
    createGame(nowMs),
    {
      cream: playerIds.cream ? { playerId: playerIds.cream, connected: true, lastSeenAtMs: nowMs } : null,
      black: playerIds.black ? { playerId: playerIds.black, connected: true, lastSeenAtMs: nowMs } : null,
    },
    nowMs,
  );

  return {
    roomId,
    match,
    players: {
      cream: playerIds.cream
        ? { color: 'cream', playerId: playerIds.cream, connected: true, lastSeenAtMs: nowMs }
        : null,
      black: playerIds.black
        ? { color: 'black', playerId: playerIds.black, connected: true, lastSeenAtMs: nowMs }
        : null,
    },
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function reconnectDamaPlayer(
  room: DamaRoomState,
  playerId: string,
  color: Side,
  nowMs = Date.now(),
): DamaRoomState {
  const seat = room.players[color];
  if (!seat || seat.playerId !== playerId) {
    return room;
  }

  return {
    ...room,
    players: {
      ...room.players,
      [color]: {
        ...seat,
        connected: true,
        lastSeenAtMs: nowMs,
      },
    },
    updatedAtMs: nowMs,
    match: {
      ...room.match,
      players: {
        ...room.match.players,
        [color]: {
          playerId: seat.playerId,
          connected: true,
          lastSeenAtMs: nowMs,
        },
      },
      updatedAtMs: nowMs,
    },
  };
}

export function disconnectDamaPlayer(
  room: DamaRoomState,
  playerId: string,
  color: Side,
  nowMs = Date.now(),
): DamaRoomState {
  const seat = room.players[color];
  if (!seat || seat.playerId !== playerId) {
    return room;
  }

  return {
    ...room,
    players: {
      ...room.players,
      [color]: {
        ...seat,
        connected: false,
        lastSeenAtMs: nowMs,
      },
    },
    updatedAtMs: nowMs,
    match: {
      ...room.match,
      players: {
        ...room.match.players,
        [color]: {
          playerId: seat.playerId,
          connected: false,
          lastSeenAtMs: nowMs,
        },
      },
      updatedAtMs: nowMs,
    },
  };
}

export function resolveDamaRoomMove(
  room: DamaRoomState,
  command: DamaMoveCommand,
  nowMs = Date.now(),
) {
  const seat = room.players[command.playerColor];
  if (!seat || seat.playerId !== command.actorPlayerId || !seat.connected) {
    return {
      accepted: false,
      reason: 'player_missing',
      matchId: room.match.matchId,
      stateVersion: room.match.version,
      turnId: room.match.turnId,
      room,
    } as const;
  }

  const outcome = resolveDamaMoveCommand(room.match, command, nowMs);
  if (!outcome.accepted) {
    return {
      ...outcome,
      room,
    };
  }

  const nextRoom: DamaRoomState = {
    ...room,
    match: outcome.state,
    updatedAtMs: nowMs,
    players: {
      ...room.players,
      [command.playerColor]: {
        ...seat,
        connected: true,
        lastSeenAtMs: nowMs,
      },
    },
  };

  return {
    ...outcome,
    state: nextRoom,
    room: nextRoom,
  };
}
