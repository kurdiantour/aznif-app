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

import {
  handSeatToBot,
  isOkeyBotControlled,
} from "../engine/okey-bot-policy.ts";

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
  controlledByBot?: boolean;
  botDifficulty?: "easy" | "normal" | "hard";
  botNumber?: number;
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

  winnerWasKonkan?: boolean;
};

export type OkeyDailyQuestMetric =
  | "okey_match_completed"
  | "okey_match_won"
  | "okey_konkan_entered"
  | "okey_konkan_won"
  | "okey_joker_stolen"
  | "okey_meld_opened"
  | "okey_opened_with_130_plus_points"
  | "okey_tile_spent_on_meld";

export type OkeyDailyQuestGameplayEvent = {
  userId: string;
  metric: OkeyDailyQuestMetric;
  amount: number;
  sourceKey: string;
  metadata: Record<string, unknown>;
};

export type OkeyAuthoritativeMatchScores = {
  teamA: number;
  teamB: number;
};

export type OkeyTimeoutDiscardEvent = {
  id: string;

  playerId: string;

  tileId: string;

  source:
    | "deck"
    | "rack";
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

  timeoutCountsByPlayerId:
    Record<string, number>;

  manualLeftPlayerIds:
    string[];

  pendingForfeitTeamId:
    OkeyTeamId | null;

leaveTerminationReason:
  | "last-human-winner"
  | "no-humans"
  | "team-forfeit"
  | null;

lastTimeoutDiscardEvent?:
  OkeyTimeoutDiscardEvent | null;

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
      controlledByBot: state.players[0].controlledByBot,
      botDifficulty: state.players[0].botDifficulty,
      botNumber: state.players[0].botNumber,
    },
    {
      id: state.players[1].id,
      name: state.players[1].name,
      controlledByBot: state.players[1].controlledByBot,
      botDifficulty: state.players[1].botDifficulty,
      botNumber: state.players[1].botNumber,
    },
    {
      id: state.players[2].id,
      name: state.players[2].name,
      controlledByBot: state.players[2].controlledByBot,
      botDifficulty: state.players[2].botDifficulty,
      botNumber: state.players[2].botNumber,
    },
    {
      id: state.players[3].id,
      name: state.players[3].name,
      controlledByBot: state.players[3].controlledByBot,
      botDifficulty: state.players[3].botDifficulty,
      botNumber: state.players[3].botNumber,
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

        kind: players[index].controlledByBot ? "bot" as const : "human" as const,

        controlledByBot:
          players[index].controlledByBot,

        botDifficulty:
          players[index].botDifficulty,

        botNumber:
          players[index].botNumber,
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

    timeoutCountsByPlayerId:
      Object.fromEntries(
        players.map((player) => [
          player.id,
          0,
        ]),
      ),

    manualLeftPlayerIds: [],

    pendingForfeitTeamId: null,

    leaveTerminationReason: null,

    lastTimeoutDiscardEvent: null,

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
  const pendingForfeitTeamId = match.pendingForfeitTeamId;
  const forfeitWinnerTeamId: OkeyTeamId | null = pendingForfeitTeamId
    ? pendingForfeitTeamId === "teamA" ? "teamB" : "teamA"
    : null;

  const finishPendingForfeit = (
    roundResults: OkeyAuthoritativeRoundResult[],
    matchScores: OkeyAuthoritativeMatchScores,
  ): OkeyAuthoritativeMatchState => {
    if (!pendingForfeitTeamId || !forfeitWinnerTeamId) {
      throw new Error("missing_pending_okey_team_forfeit");
    }

    const remainingMembers = finishedRound.players.filter(
      (player) => !(match.manualLeftPlayerIds ?? []).includes(player.id),
    );

    if (
      remainingMembers.some((player) => player.teamId === pendingForfeitTeamId) ||
      !remainingMembers.some((player) => player.teamId === forfeitWinnerTeamId)
    ) {
      throw new Error("invalid_pending_okey_team_forfeit");
    }

    return {
      ...match,
      roundResults,
      matchScores,
      matchFinished: true,
      matchWinnerTeamId: forfeitWinnerTeamId,
      roundState: finishedRound,
    };
  };

  /*
   * پایان دسته بدون برنده:
   * همان شماره راند دوباره اجرا می‌شود.
   */
  if (
    finishedRound.endReason ===
    "tile-cycle-limit"
  ) {
    if (pendingForfeitTeamId) {
      return finishPendingForfeit(match.roundResults, match.matchScores);
    }

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

      winnerWasKonkan: finishedRound.players.some(
        (player) => player.id === finishedRound.winnerId && player.konkan,
      ),
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

  if (pendingForfeitTeamId) {
    return finishPendingForfeit(nextRoundResults, nextScores);
  }

  if (match.leaveTerminationReason === "last-human-winner") {
    const remainingHumans = finishedRound.players.filter(
      (player) => !(match.manualLeftPlayerIds ?? []).includes(player.id),
    );

    if (remainingHumans.length !== 1) {
      throw new Error("last_human_winner_requires_one_human");
    }

    return {
      ...match,
      roundResults: nextRoundResults,
      matchScores: nextScores,
      matchFinished: true,
      matchWinnerTeamId: remainingHumans[0].teamId,
      roundState: finishedRound,
    };
  }

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
      orderedRunTileIds: string[];
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

    settlement?: OkeyMatchSettlement | null;

    lastTimeoutDiscardEvent:
      OkeyTimeoutDiscardEvent | null;
  };

export type OkeyMatchSettlement = {
  type: "winner" | "no_winner";
  currency: "fun" | "aznif";
  winnerTeamId?: OkeyTeamId;
  entryFeePerPlayer: number;
  payoutPerWinner: number;
  playerReward?: {
    pointDelta: number;
    gemDelta: number;
  } | null;
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
        command.orderedRunTileIds,
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

function reconcileAuthoritativeHumanControl(
  match: OkeyAuthoritativeMatchState,
): OkeyAuthoritativeMatchState {
  if (match.matchFinished) return match;

  const remainingMembers = match.roundState.players.filter(
    (player) => !(match.manualLeftPlayerIds ?? []).includes(player.id),
  );

  if (remainingMembers.length === 0) {
    return {
      ...match,
      pendingForfeitTeamId: null,
      leaveTerminationReason: "no-humans",
      matchFinished: true,
      matchWinnerTeamId: null,
    };
  }

  const remainingTeamIds = new Set(
    remainingMembers.map((player) => player.teamId),
  );
  const pendingForfeitTeamId: OkeyTeamId | null =
    remainingTeamIds.size === 1
      ? remainingMembers[0].teamId === "teamA" ? "teamB" : "teamA"
      : null;

  return {
    ...match,
    pendingForfeitTeamId,
    leaveTerminationReason: pendingForfeitTeamId ? "team-forfeit" : null,
  };
}

function reconcileAuthoritativeBotOwnership(
  match: OkeyAuthoritativeMatchState,
): OkeyAuthoritativeMatchState {
  let current = reconcileAuthoritativeHumanControl(match);

  if (current.matchFinished) {
    return current;
  }

  const playerIndex =
    current.roundState.currentPlayerIndex;

  const player =
    current.roundState.players[playerIndex];

  if (
    player &&
    !isOkeyBotControlled(player) &&
    (current.timeoutCountsByPlayerId?.[player.id] ?? 0) >= 2
  ) {
    current = reconcileAuthoritativeHumanControl({
      ...current,
      roundState: handSeatToBot(
        current.roundState,
        playerIndex,
        "normal",
      ),
    });
  }

  return current;
}

export function applyAuthoritativeManualLeave(
  match: OkeyAuthoritativeMatchState,
  actorPlayerIndex: number,
): OkeyAuthoritativeMatchState {
  if (match.matchFinished) {
    throw new OkeyCommandError(
      "command_rejected",
    );
  }

  const player =
    match.roundState.players[actorPlayerIndex];

  if (!player) {
    throw new OkeyCommandError(
      "command_rejected",
    );
  }

  const manualLeftPlayerIds = (match.manualLeftPlayerIds ?? []).includes(player.id)
    ? match.manualLeftPlayerIds
    : [...(match.manualLeftPlayerIds ?? []), player.id];

  const takeoverMatch = reconcileAuthoritativeHumanControl({
    ...match,
    manualLeftPlayerIds,
    roundState: isOkeyBotControlled(player)
      ? match.roundState
      : handSeatToBot(
          match.roundState,
          actorPlayerIndex,
          "normal",
        ),
  });

  return takeoverMatch;
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

  const currentPlayer = match.roundState.players[actorPlayerIndex];

  if (
    currentPlayer &&
    !isOkeyBotControlled(currentPlayer) &&
    (match.timeoutCountsByPlayerId?.[currentPlayer.id] ?? 0) >= 2
  ) {
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

  const actor =
    match.roundState.players[actorPlayerIndex];

  const nextTimeoutCounts =
    actor && !isOkeyBotControlled(actor)
      ? {
          ...(match.timeoutCountsByPlayerId ?? {}),
          [actor.id]: 0,
        }
      : match.timeoutCountsByPlayerId;

  return reconcileAuthoritativeBotOwnership(
    settleAuthoritativeOkeyRound({
      ...match,
      timeoutCountsByPlayerId:
        nextTimeoutCounts,
      roundState:
        nextRoundState,
    }),
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function deriveOkeyDailyQuestGameplayEvents(
  previous: OkeyAuthoritativeMatchState,
  next: OkeyAuthoritativeMatchState,
  actorPlayerIndex: number,
  command: OkeyAuthoritativeCommand | {
    type: "manual-leave" | "system-timeout";
  },
  commandId: string,
): OkeyDailyQuestGameplayEvent[] {
  const events: OkeyDailyQuestGameplayEvent[] = [];
  const actorBefore = previous.roundState.players[actorPlayerIndex];
  const actorAfter = next.roundState.players.find(
    (player) => player.id === actorBefore?.id,
  );
  const push = (
    userId: string | undefined,
    metric: OkeyDailyQuestMetric,
    amount = 1,
    suffix: string = metric,
    metadata: Record<string, unknown> = {},
  ) => {
    if (!userId || !UUID_PATTERN.test(userId) || amount <= 0) return;
    events.push({
      userId,
      metric,
      amount,
      sourceKey: `${commandId}:${userId}:${suffix}`,
      metadata,
    });
  };

  if (actorBefore && actorAfter) {
    if (!actorBefore.konkan && actorAfter.konkan) {
      push(actorBefore.id, "okey_konkan_entered");
    }

    if (command.type === "open-melds" && !actorBefore.opened && actorAfter.opened) {
      push(actorBefore.id, "okey_meld_opened");
      if (actorAfter.scoreOpened >= 130) {
        push(
          actorBefore.id,
          "okey_opened_with_130_plus_points",
          1,
          "okey_opened_with_130_plus_points",
          { score: actorAfter.scoreOpened },
        );
      }
    }

    if (command.type === "spend-meld" || command.type === "lock-konkan") {
      push(actorBefore.id, "okey_tile_spent_on_meld");
    }

    const stolenBefore = new Set(
      actorBefore.hand
        .filter((tile) => tile.jokerOrigin === "stolen")
        .map((tile) => tile.id),
    );
    const stolenCount = actorAfter.hand.filter(
      (tile) => tile.jokerOrigin === "stolen" && !stolenBefore.has(tile.id),
    ).length;
    push(actorBefore.id, "okey_joker_stolen", stolenCount);
  }

  const appendedResults = next.roundResults.slice(previous.roundResults.length);
  appendedResults.forEach((result) => {
    if (result.winnerWasKonkan) {
      push(
        result.winnerId ?? undefined,
        "okey_konkan_won",
        1,
        `okey_konkan_won:round:${result.round}`,
      );
    }
  });

  if (!previous.matchFinished && next.matchFinished) {
    for (const player of previous.roundState.players) {
      push(player.id, "okey_match_completed");
      if (next.matchWinnerTeamId && player.teamId === next.matchWinnerTeamId) {
        push(player.id, "okey_match_won");
      }
    }
  }

  return events;
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

  if (
    !deadlineAt ||
    Date.parse(deadlineAt) > now
  ) {
    throw new OkeyCommandError(
      "deadline_expired",
    );
  }

  const playerIndex =
    match.roundState.currentPlayerIndex;

  const player =
    match.roundState.players[playerIndex];

  if (!player) {
    throw new OkeyCommandError(
      "command_rejected",
    );
  }

  if (isOkeyBotControlled(player)) {
    throw new OkeyCommandError(
      "command_rejected",
    );
  }

  const timeoutCounts =
    match.timeoutCountsByPlayerId ?? {};

  const timeoutCount =
    (timeoutCounts[player.id] ?? 0) + 1;

const nextTimeoutCounts = {
  ...timeoutCounts,
  [player.id]: timeoutCount,
};


const timeoutDiscardTile =
  match.roundState.hasDrawnThisTurn
    ? player.hand[
        player.hand.length - 1
      ] ?? null
    : match.roundState.deck[0] ??
      null;


const timeoutDiscardSource:
  | "deck"
  | "rack" =
  match.roundState.hasDrawnThisTurn
    ? "rack"
    : "deck";


const nextRoundState =
  resolveAuthoritativeDeadline(
    match.roundState,
    deadlineAt,
    now,
  );


const lastTimeoutDiscardEvent:
  OkeyTimeoutDiscardEvent | null =
  timeoutDiscardTile
    ? {
        id: [
          "timeout",
          now,
          player.id,
          timeoutCount,
          timeoutDiscardTile.id,
        ].join("-"),

        playerId:
          player.id,

        tileId:
          timeoutDiscardTile.id,

        source:
          timeoutDiscardSource,
      }
    : null;


return reconcileAuthoritativeBotOwnership(
  settleAuthoritativeOkeyRound({
    ...match,
    timeoutCountsByPlayerId: nextTimeoutCounts,
    lastTimeoutDiscardEvent,
    roundState: nextRoundState,
  }),
);
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

  const player = match.roundState.players[match.roundState.currentPlayerIndex];

  if (
    !player ||
    isOkeyBotControlled(player) ||
    (match.timeoutCountsByPlayerId?.[player.id] ?? 0) >= 2
  ) {
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

    lastTimeoutDiscardEvent:
      match.lastTimeoutDiscardEvent ??
  null,
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