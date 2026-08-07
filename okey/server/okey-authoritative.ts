import {
  createInitialOkeyGame,
  declareKonkanOpen,
  discardTile,
  drawTile,
  getMatchWinnerTeamId,
  getNextRoundDealerIndex,
  getRoundResultScoreDetails,
  lockKonkanSet,
  openPlayerMelds,
  spendTileOnMeld,
} from "../engine/okey-engine.ts";

import {
  resolveTimeoutTurn,
} from "../engine/okey-timeout.ts";

import type {
  OkeyGameState,
  OkeyMeld,
  OkeyTile,
} from "../types/okey.ts";

export const OKEY_SERVER_TURN_SECONDS = 20;
export const OKEY_MAX_ROUNDS = 7;

export type OkeyTeamId =
  | "teamA"
  | "teamB";

export type OkeyServerPlayerIdentity = {
  id: string;
  name: string;
};

export type OkeyAuthoritativeRoundResult = {
  round: number;

  winnerId: string | null;

  winnerTeamId:
    OkeyTeamId | null;

  teamAScore: number;

  teamBScore: number;

  endReason:
    OkeyGameState["endReason"];
};

export type OkeyAuthoritativeMatchScores = {
  teamA: number;
  teamB: number;
};

export type OkeyAuthoritativeMatchState = {
  currentRound: number;

  roundResults:
    OkeyAuthoritativeRoundResult[];

  matchScores:
    OkeyAuthoritativeMatchScores;

  matchFinished: boolean;

  matchWinnerTeamId:
    OkeyTeamId | null;

  roundState: OkeyGameState;
};

function secureRandom(): number {
  const value =
    new Uint32Array(1);

  crypto.getRandomValues(value);

  return (
    value[0] /
    0x1_0000_0000
  );
}

function getPlayerIdentities(
  state: OkeyGameState,
): readonly [
  OkeyServerPlayerIdentity,
  OkeyServerPlayerIdentity,
  OkeyServerPlayerIdentity,
  OkeyServerPlayerIdentity,
] {
  if (state.players.length !== 4) {
    throw new Error(
      "okey_match_requires_four_players",
    );
  }

  return [
    {
      id: state.players[0].id,
      name: state.players[0].name,
    },
    {
      id: state.players[1].id,
      name: state.players[1].name,
    },
    {
      id: state.players[2].id,
      name: state.players[2].name,
    },
    {
      id: state.players[3].id,
      name: state.players[3].name,
    },
  ];
}

function getWinnerTeamId(
  state: OkeyGameState,
): OkeyTeamId | null {
  if (
    state.phase !== "finished" ||
    !state.winnerId
  ) {
    return null;
  }

  const winner =
    state.players.find(
      (player) =>
        player.id === state.winnerId,
    );

  if (
    winner?.teamId !== "teamA" &&
    winner?.teamId !== "teamB"
  ) {
    return null;
  }

  return winner.teamId;
}

export function createAuthoritativeOkeyGame(
  players: readonly [
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
  ],

  dealerIndex = Math.floor(
    secureRandom() * 4,
  ),
): OkeyGameState {
  const state =
    createInitialOkeyGame(
      dealerIndex,
      secureRandom,
    );

  return {
    ...state,

    players: state.players.map(
      (player, index) => ({
        ...player,

        id: players[index].id,

        name:
          players[index].name,

        kind: "human" as const,
      }),
    ),

    turnMessage: {
      code: state.hasDrawnThisTurn
        ? "discard-tile"
        : "draw-tile",

      playerName:
        players[
          state.currentPlayerIndex
        ].name,
    },
  };
}

export function createAuthoritativeOkeyMatch(
  players: readonly [
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
  ],

  dealerIndex = Math.floor(
    secureRandom() * 4,
  ),
): OkeyAuthoritativeMatchState {
  return {
    currentRound: 1,

    roundResults: [],

    matchScores: {
      teamA: 0,
      teamB: 0,
    },

    matchFinished: false,

    matchWinnerTeamId: null,

    roundState:
      createAuthoritativeOkeyGame(
        players,
        dealerIndex,
      ),
  };
}

/**
 * نتیجه یک راند تمام‌شده را سمت سرور ثبت می‌کند.
 *
 * حالت برد:
 * - امتیاز راند محاسبه می‌شود.
 * - نتیجه به roundResults اضافه می‌شود.
 * - امتیاز تجمعی تیم‌ها به‌روزرسانی می‌شود.
 * - پس از راندهای ۱ تا ۶، راند بعدی ساخته می‌شود.
 * - پس از راند هفتم، Match تمام می‌شود.
 *
 * حالت tile-cycle-limit:
 * - نتیجه و امتیازی ثبت نمی‌شود.
 * - شماره راند جلو نمی‌رود.
 * - همان راند دوباره ساخته می‌شود.
 */
export function settleAuthoritativeOkeyRound(
  match:
    OkeyAuthoritativeMatchState,
): OkeyAuthoritativeMatchState {
  const finishedRound =
    match.roundState;

  if (
    match.matchFinished ||
    finishedRound.phase !==
      "finished"
  ) {
    return match;
  }

  const players =
    getPlayerIdentities(
      finishedRound,
    );

  /*
   * پایان دسته بدون برنده:
   * همان شماره راند دوباره اجرا می‌شود.
   */
  if (
    finishedRound.endReason ===
    "tile-cycle-limit"
  ) {
    return {
      ...match,

      roundState:
        createAuthoritativeOkeyGame(
          players,
          finishedRound.dealerIndex,
        ),
    };
  }

  /*
   * از ثبت دوباره نتیجه همان راند جلوگیری می‌کند.
   */
  const alreadySettled =
    match.roundResults.some(
      (result) =>
        result.round ===
        match.currentRound,
    );

  if (alreadySettled) {
    return match;
  }

  if (!finishedRound.winnerId) {
    throw new Error(
      "finished_okey_round_missing_winner",
    );
  }

  const winnerTeamId =
    getWinnerTeamId(
      finishedRound,
    );

  if (!winnerTeamId) {
    throw new Error(
      "finished_okey_round_missing_winner_team",
    );
  }

  const scoreDetails =
    getRoundResultScoreDetails(
      finishedRound,
    );

  const roundResult:
    OkeyAuthoritativeRoundResult = {
      round:
        match.currentRound,

      winnerId:
        finishedRound.winnerId,

      winnerTeamId,

      teamAScore:
        scoreDetails.scores.teamA,

      teamBScore:
        scoreDetails.scores.teamB,

      endReason:
        finishedRound.endReason,
    };

  const nextScores:
    OkeyAuthoritativeMatchScores = {
      teamA:
        match.matchScores.teamA +
        scoreDetails.scores.teamA,

      teamB:
        match.matchScores.teamB +
        scoreDetails.scores.teamB,
  };

  const nextRoundResults = [
    ...match.roundResults,
    roundResult,
  ];

  const isFinalRound =
    match.currentRound >=
    OKEY_MAX_ROUNDS;

  /*
   * پایان راند هفتم:
   * roundState تمام‌شده نگه داشته می‌شود
   * تا نتیجه نهایی قابل نمایش باشد.
   */
  if (isFinalRound) {
    return {
      ...match,

      roundResults:
        nextRoundResults,

      matchScores:
        nextScores,

      matchFinished: true,

      matchWinnerTeamId:
        getMatchWinnerTeamId(
          nextScores,
        ),

      roundState:
        finishedRound,
    };
  }

  /*
   * در راندهای ۱ تا ۶،
   * برنده همان راند Dealer راند بعد می‌شود.
   */
  const nextDealerIndex =
    getNextRoundDealerIndex(
      finishedRound,
    );

  return {
    ...match,

    currentRound:
      match.currentRound + 1,

    roundResults:
      nextRoundResults,

    matchScores:
      nextScores,

    matchFinished: false,

    matchWinnerTeamId: null,

    roundState:
      createAuthoritativeOkeyGame(
        players,
        nextDealerIndex,
      ),
  };
}

export type OkeyAuthoritativeCommand =
  | {
      type: "draw";
      source:
        | "deck"
        | "discard";
    }
  | {
      type: "discard";
      tileId: string;
    }
  | {
      type: "open-melds";
      melds: OkeyMeld[];
      score: number;
    }
  | {
      type: "declare-konkan";
    }
  | {
      type: "spend-meld";
      tileId: string;
      targetPlayerId: string;
      targetMeldId: string;
    }
  | {
      type: "lock-konkan";
      tileId: string;
      targetPlayerId: string;
      targetMeldId: string;
    };

export type OkeyProjectedPlayer =
  Omit<
    OkeyGameState["players"][number],
    "hand"
  > & {
    handCount: number;
    hand?: OkeyTile[];
  };

export type OkeyServerProjection =
  Omit<
    OkeyGameState,
    "players" | "deck"
  > & {
    players:
      OkeyProjectedPlayer[];

    deckCount: number;

    version: number;

    turnDeadlineAt:
      string | null;
  };
export type OkeyMatchServerProjection =
  OkeyServerProjection & {
    currentRound: number;

    maxRounds: number;

    roundResults:
      OkeyAuthoritativeRoundResult[];

    matchScores:
      OkeyAuthoritativeMatchScores;

    matchFinished: boolean;

    matchWinnerTeamId:
      OkeyTeamId | null;
  };
  
export class OkeyCommandError
  extends Error {
  readonly code:
    | "invalid_command"
    | "not_your_turn"
    | "command_rejected"
    | "deadline_expired";

  constructor(
    code:
      | "invalid_command"
      | "not_your_turn"
      | "command_rejected"
      | "deadline_expired",
  ) {
    super(code);

    this.name =
      "OkeyCommandError";

    this.code = code;
  }
}

export function applyAuthoritativeOkeyCommand(
  state: OkeyGameState,

  actorPlayerIndex: number,

  command:
    OkeyAuthoritativeCommand,
): OkeyGameState {
  if (
    state.phase !== "playing"
  ) {
    throw new OkeyCommandError(
      "command_rejected",
    );
  }

  if (
    state.currentPlayerIndex !==
    actorPlayerIndex
  ) {
    throw new OkeyCommandError(
      "not_your_turn",
    );
  }

  let next: OkeyGameState;

  switch (command.type) {
    case "draw":
      next = drawTile(
        state,
        command.source,
      );
      break;

    case "discard":
      next = discardTile(
        state,
        command.tileId,
      );
      break;

    case "open-melds":
      next = openPlayerMelds(
        state,
        actorPlayerIndex,
        command.melds,
        command.score,
      );
      break;

    case "declare-konkan":
      next = declareKonkanOpen(
        state,
        actorPlayerIndex,
      );
      break;

    case "spend-meld":
      next = spendTileOnMeld(
        state,
        actorPlayerIndex,
        command.tileId,
        command.targetPlayerId,
        command.targetMeldId,
      );
      break;

    case "lock-konkan":
      next = lockKonkanSet(
        state,
        actorPlayerIndex,
        command.tileId,
        command.targetPlayerId,
        command.targetMeldId,
      );
      break;

    default:
      throw new OkeyCommandError(
        "invalid_command",
      );
  }

  if (next === state) {
    throw new OkeyCommandError(
      "command_rejected",
    );
  }

  return next;
}

export function applyAuthoritativeOkeyMatchCommand(
  match:
    OkeyAuthoritativeMatchState,

  actorPlayerIndex: number,

  command:
    OkeyAuthoritativeCommand,
): OkeyAuthoritativeMatchState {
  if (match.matchFinished) {
    throw new OkeyCommandError(
      "command_rejected",
    );
  }

  const nextRoundState =
    applyAuthoritativeOkeyCommand(
      match.roundState,
      actorPlayerIndex,
      command,
    );

  return settleAuthoritativeOkeyRound({
    ...match,
    roundState:
      nextRoundState,
  });
}

export function resolveAuthoritativeDeadline(
  state: OkeyGameState,

  deadlineAt: string | null,

  now = Date.now(),
): OkeyGameState {
  if (
    !deadlineAt ||
    Date.parse(deadlineAt) >
      now
  ) {
    throw new OkeyCommandError(
      "deadline_expired",
    );
  }

  const next =
    resolveTimeoutTurn(
      state,
      state.currentPlayerIndex,
    );

  if (next === state) {
    throw new OkeyCommandError(
      "command_rejected",
    );
  }

  return next;
}

export function resolveAuthoritativeMatchDeadline(
  match:
    OkeyAuthoritativeMatchState,

  deadlineAt: string | null,

  now = Date.now(),
): OkeyAuthoritativeMatchState {
  if (match.matchFinished) {
    throw new OkeyCommandError(
      "command_rejected",
    );
  }

  const nextRoundState =
    resolveAuthoritativeDeadline(
      match.roundState,
      deadlineAt,
      now,
    );

  return settleAuthoritativeOkeyRound({
    ...match,
    roundState:
      nextRoundState,
  });
}

export function getNextOkeyTurnDeadline(
  state: OkeyGameState,

  now = Date.now(),
): string | null {
  if (
    state.phase !== "playing"
  ) {
    return null;
  }

  return new Date(
    now +
      OKEY_SERVER_TURN_SECONDS *
        1000,
  ).toISOString();
}

export function getNextOkeyMatchTurnDeadline(
  match:
    OkeyAuthoritativeMatchState,

  now = Date.now(),
): string | null {
  if (match.matchFinished) {
    return null;
  }

  return getNextOkeyTurnDeadline(
    match.roundState,
    now,
  );
}

export function projectOkeyState(
  state: OkeyGameState,

  viewerPlayerIndex:
    number | null,

  version: number,

  turnDeadlineAt:
    string | null,
): OkeyServerProjection {
  const {
    players,
    deck,
    ...publicState
  } = state;

  return {
    ...publicState,

    players: players.map(
      (player, index) => {
        const {
          hand,
          ...visiblePlayer
        } = player;

        return {
          ...visiblePlayer,

          handCount:
            hand.length,

          ...(index ===
          viewerPlayerIndex
            ? { hand }
            : {}),
        };
      },
    ),

    deckCount: deck.length,

    version,

    turnDeadlineAt,
  };
}

export function projectOkeyPublicState(
  state: OkeyGameState,

  version: number,

  turnDeadlineAt:
    string | null,
): OkeyServerProjection {
  return projectOkeyState(
    state,
    null,
    version,
    turnDeadlineAt,
  );
}

export function projectOkeyMatchState(
  match:
    OkeyAuthoritativeMatchState,

  viewerPlayerIndex:
    number | null,

  version: number,

  turnDeadlineAt:
    string | null,
): OkeyMatchServerProjection {
  return {
    ...projectOkeyState(
      match.roundState,
      viewerPlayerIndex,
      version,
      turnDeadlineAt,
    ),

    currentRound:
      match.currentRound,

    maxRounds:
      OKEY_MAX_ROUNDS,

    roundResults:
      match.roundResults,

    matchScores:
      match.matchScores,

    matchFinished:
      match.matchFinished,

    matchWinnerTeamId:
      match.matchWinnerTeamId,
  };
}

export function projectOkeyMatchPublicState(
  match:
    OkeyAuthoritativeMatchState,

  version: number,

  turnDeadlineAt:
    string | null,
): OkeyMatchServerProjection {
  return projectOkeyMatchState(
    match,
    null,
    version,
    turnDeadlineAt,
  );
}