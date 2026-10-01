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
  playEliminatedTurn,
  spendTileOnMeld,
} from "../engine/okey-engine.ts";

import { OKEY_RULESET_V1 } from "../rules/okey-ruleset-v1.ts";
import { isEliminatedOkeyPlayer } from "../engine/okeyengine-eliminated.ts";
import {
  deriveAuthoritativeOkeyTurnDeadline,
  getAuthoritativeOkeyTurnContext,
  type OkeyAuthoritativeTransitionReducers,
  OKEY_DRAW_PHASE_SECONDS,
  OKEY_THROW_PHASE_SECONDS,
} from "./okey-turn-engine.ts";

export { OKEY_DRAW_PHASE_SECONDS, OKEY_THROW_PHASE_SECONDS };

import {
  resolveTimeoutTurn,
} from "../engine/okey-engine.ts";

import {
  handSeatToBot,
  isOkeyBotControlled,
} from "../engine/okey-bot-engine.ts";

import type {
  OkeyGameState,
  OkeyMeld,
  OkeyTile,
} from "../types/okey.ts";

const OKEY_DRAW_TIMEOUT_TAKEOVER_THRESHOLD = 2;

export type OkeyTeamId =
  | "teamA"
  | "teamB";

export type OkeyServerPlayerIdentity = {
  id: string;
  name: string;
  avatarId?: string;
  avatarUrl?: string;
  controlledByBot?: boolean;
  botDifficulty?: "easy" | "normal" | "hard";
  botNumber?: number;
  originalName?: string;
  originalAvatarId?: string;
  originalAvatarUrl?: string;
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

  forcedKonkanTeamId?: OkeyTeamId | null;

  roundStartsAt?: string | null;

  nextRoundEligibleAt: string | null;

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
      avatarId: state.players[0].avatarId,
      avatarUrl: state.players[0].avatarUrl,
      controlledByBot: state.players[0].controlledByBot,
      botDifficulty: state.players[0].botDifficulty,
      botNumber: state.players[0].botNumber,
      originalName: state.players[0].originalName,
      originalAvatarId: state.players[0].originalAvatarId,
      originalAvatarUrl: state.players[0].originalAvatarUrl,
    },
    {
      id: state.players[1].id,
      name: state.players[1].name,
      avatarId: state.players[1].avatarId,
      avatarUrl: state.players[1].avatarUrl,
      controlledByBot: state.players[1].controlledByBot,
      botDifficulty: state.players[1].botDifficulty,
      botNumber: state.players[1].botNumber,
      originalName: state.players[1].originalName,
      originalAvatarId: state.players[1].originalAvatarId,
      originalAvatarUrl: state.players[1].originalAvatarUrl,
    },
    {
      id: state.players[2].id,
      name: state.players[2].name,
      avatarId: state.players[2].avatarId,
      avatarUrl: state.players[2].avatarUrl,
      controlledByBot: state.players[2].controlledByBot,
      botDifficulty: state.players[2].botDifficulty,
      botNumber: state.players[2].botNumber,
      originalName: state.players[2].originalName,
      originalAvatarId: state.players[2].originalAvatarId,
      originalAvatarUrl: state.players[2].originalAvatarUrl,
    },
    {
      id: state.players[3].id,
      name: state.players[3].name,
      avatarId: state.players[3].avatarId,
      avatarUrl: state.players[3].avatarUrl,
      controlledByBot: state.players[3].controlledByBot,
      botDifficulty: state.players[3].botDifficulty,
      botNumber: state.players[3].botNumber,
      originalName: state.players[3].originalName,
      originalAvatarId: state.players[3].originalAvatarId,
      originalAvatarUrl: state.players[3].originalAvatarUrl,
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

        avatarId:
          players[index].avatarId,

        avatarUrl:
          players[index].avatarUrl,

        kind: players[index].controlledByBot ? "bot" as const : "human" as const,

        controlledByBot:
          players[index].controlledByBot,

        botDifficulty:
          players[index].botDifficulty,

        botNumber:
          players[index].botNumber,

        originalName:
          players[index].originalName,

        originalAvatarId:
          players[index].originalAvatarId,

        originalAvatarUrl:
          players[index].originalAvatarUrl,
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
    forcedKonkanTeamId: null,
    roundStartsAt: null,
    nextRoundEligibleAt: null,
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
  now = Date.now(),
): OkeyAuthoritativeMatchState {
  const finishedRound =
    match.roundState;

  if (
    match.matchFinished ||
    finishedRound.phase !== "finished"
  ) {
    return match;
  }

  const pendingForfeitTeamId = match.pendingForfeitTeamId;
  // This is an official rule transition, not a presentation window. Clients
  // may keep showing the completed round, but the server can start the next
  // round from the instant the result is committed.
  const nextRoundEligibleAt = new Date(now).toISOString();
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
      (player) => !isOkeyTerminalTakeover(match, player),
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
      nextRoundEligibleAt: null,
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
      nextRoundEligibleAt,
      roundState: finishedRound,
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
    if (pendingForfeitTeamId) {
      return finishPendingForfeit(match.roundResults, match.matchScores);
    }

    return match.nextRoundEligibleAt
      ? match
      : { ...match, nextRoundEligibleAt };
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
      nextRoundEligibleAt: null,
      roundState: finishedRound,
    };
  }

  const isFinalRound =
    match.currentRound >=
    OKEY_RULESET_V1.match.roundCount;

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

      nextRoundEligibleAt: null,

      roundState:
        finishedRound,
    };
  }

  return {
    ...match,
    roundResults:
      nextRoundResults,
    matchScores:
      nextScores,
    matchFinished: false,
    matchWinnerTeamId: null,

    nextRoundEligibleAt,
    roundState: finishedRound,
  };
}

/**
 * Starts exactly one new authoritative round from a committed FINISHED state.
 * Optimistic concurrency is enforced by the database commit that wraps this
 * pure transition; this function owns only the lifecycle validation/state.
 */
export function startAuthoritativeOkeyNextRound(
  match: OkeyAuthoritativeMatchState,
  now = Date.now(),
): OkeyAuthoritativeMatchState {
  if (
    match.matchFinished ||
    match.pendingForfeitTeamId ||
    match.leaveTerminationReason === "team-forfeit" ||
    match.roundState.phase !== "finished"
  ) {
    throw new OkeyCommandError("command_rejected");
  }

  const finishedRound = match.roundState;
  const repeatsCurrentRound = finishedRound.endReason === "tile-cycle-limit";
  const completedResult = match.roundResults.some(
    (result) => result.round === match.currentRound,
  );

  if (!repeatsCurrentRound && !completedResult) {
    throw new OkeyCommandError("command_rejected");
  }

  const dealerIndex = repeatsCurrentRound
    ? finishedRound.dealerIndex
    : getNextRoundDealerIndex(finishedRound);

  const nextRound = repeatsCurrentRound ? match.currentRound : match.currentRound + 1;
  const isDetermineRound = !repeatsCurrentRound && nextRound === OKEY_RULESET_V1.match.determineRound;
  const scoreGap = Math.abs(match.matchScores.teamA - match.matchScores.teamB);
  const trailingTeamId: OkeyTeamId | null = match.matchScores.teamA === match.matchScores.teamB
    ? null
    : match.matchScores.teamA > match.matchScores.teamB ? "teamA" : "teamB";

  if (isDetermineRound && trailingTeamId && scoreGap >= OKEY_RULESET_V1.match.konkanRecoveryPoints) {
    return {
      ...match,
      matchFinished: true,
      matchWinnerTeamId: trailingTeamId === "teamA" ? "teamB" : "teamA",
      nextRoundEligibleAt: null,
      forcedKonkanTeamId: null,
      roundStartsAt: null,
    };
  }

  const forcedKonkanTeamId = isDetermineRound && trailingTeamId && scoreGap >= OKEY_RULESET_V1.match.normalRecoveryPoints
    ? trailingTeamId
    : null;
  const roundStartsAt = forcedKonkanTeamId
    ? new Date(now + OKEY_RULESET_V1.match.forceKonkanAnnouncementMs).toISOString()
    : null;
  const nextRoundState = createAuthoritativeOkeyGame(getPlayerIdentities(finishedRound), dealerIndex);
  const forceKonkanRoundState = forcedKonkanTeamId
    ? {
        ...nextRoundState,
        players: nextRoundState.players.map((player) => player.teamId === forcedKonkanTeamId
          ? { ...player, konkan: true, konkanEntryReason: "forced-final-round" as const }
          : player),
      }
    : nextRoundState;

  return {
    ...match,
    currentRound: nextRound,
    nextRoundEligibleAt: null,
    forcedKonkanTeamId,
    roundStartsAt,
    roundState: forceKonkanRoundState,
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
      type: "open-and-discard";
      melds: OkeyMeld[];
      score: number;
      tileId: string;
    }
  | {
      type: "declare-konkan";
      orderedRunTileIds: string[];
      completionMeldTileIds: string[];
      discardTileId: string;
    }
  | {
      type: "spend-meld";
      tileId: string;
      targetPlayerId: string;
      targetMeldId: string;
      runEnd?: "start" | "end";
    }
  | {
      type: "lock-konkan";
      tileId: string;
      targetPlayerId: string;
      targetMeldId: string;
      runEnd?: "start" | "end";
    }
  | {
      type: "take-back-seat";
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

    turnDurationSeconds:
      number;
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

    nextRoundEligibleAt: string | null;

    forcedKonkanTeamId: OkeyTeamId | null;

    roundStartsAt: string | null;

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
    command.type !== "take-back-seat" &&
    state.phase !== "playing"
  ) {
    throw new OkeyCommandError(
      "command_rejected",
    );
  }

  if (
    command.type !== "take-back-seat" &&
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

    case "open-and-discard": {
      const opened = openPlayerMelds(state, actorPlayerIndex, command.melds, command.score, { finalDiscard: true });
      if (isEliminatedOkeyPlayer(opened.players[actorPlayerIndex])) {
        next = opened;
      } else {
        next = opened === state ? state : discardTile(opened, command.tileId);
        if (next === opened) next = state;
      }
      break;
    }

    case "declare-konkan":
      next = declareKonkanOpen(
        state,
        actorPlayerIndex,
        command.orderedRunTileIds,
        command.completionMeldTileIds,
        command.discardTileId,
      );
      break;

    case "spend-meld":
      next = spendTileOnMeld(
        state,
        actorPlayerIndex,
        command.tileId,
        command.targetPlayerId,
        command.targetMeldId,
        command.runEnd,
      );
      break;

    case "lock-konkan":
      next = lockKonkanSet(
        state,
        actorPlayerIndex,
        command.tileId,
        command.targetPlayerId,
        command.targetMeldId,
        command.runEnd,
      );
      break;

    case "take-back-seat": {
      const player = state.players[actorPlayerIndex];
      if (!player.controlledByBot) {
        throw new OkeyCommandError("command_rejected");
      }

      const restoredName = player.originalName ?? player.name;
      const turnMessage =
        "playerName" in state.turnMessage && state.turnMessage.playerName === player.name
          ? { ...state.turnMessage, playerName: restoredName }
          : state.turnMessage;

      next = {
        ...state,
        turnMessage,
        players: state.players.map((p, i) =>
          i === actorPlayerIndex
            ? {
                ...p,
                name: restoredName,
                avatarId: p.originalAvatarId,
                avatarUrl: p.originalAvatarUrl,
                controlledByBot: false,
                kind: "human",
                botDifficulty: undefined,
                botNumber: undefined,
                originalName: undefined,
                originalAvatarId: undefined,
                originalAvatarUrl: undefined,
              }
            : p,
        ),
      };
      break;
    }

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

function isOkeyTerminalTakeover(
  match: OkeyAuthoritativeMatchState,
  player: OkeyAuthoritativeMatchState["roundState"]["players"][number],
): boolean {
  return (match.manualLeftPlayerIds ?? []).includes(player.id);
}

function reconcileAuthoritativeHumanControl(
  match: OkeyAuthoritativeMatchState,
): OkeyAuthoritativeMatchState {
  if (match.matchFinished) return match;

  const remainingMembers = match.roundState.players.filter(
    (player) => !isOkeyTerminalTakeover(match, player),
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

  const teamA = match.roundState.players.filter((p) => p.teamId === "teamA");
  const teamB = match.roundState.players.filter((p) => p.teamId === "teamB");

  const isTeamForfeited = (team: typeof teamA) => {
    if (team.length === 0) return false;
    const allBots = team.every((p) => p.controlledByBot || p.kind === "bot");
    if (!allBots) return false;
    
    const hasTakeover = team.some((p) =>
      (match.manualLeftPlayerIds ?? []).includes(p.id) ||
      (match.timeoutCountsByPlayerId?.[p.id] ?? 0) >= OKEY_DRAW_TIMEOUT_TAKEOVER_THRESHOLD
    );
    return hasTakeover;
  };

  const teamAForfeited = isTeamForfeited(teamA);
  const teamBForfeited = isTeamForfeited(teamB);

  const pendingForfeitTeamId: OkeyTeamId | null = teamAForfeited ? "teamA" : teamBForfeited ? "teamB" : null;

  if (pendingForfeitTeamId) {
    const winnerTeamId: OkeyTeamId =
      pendingForfeitTeamId === "teamA" ? "teamB" : "teamA";

    return {
      ...match,
      pendingForfeitTeamId,
      leaveTerminationReason: "team-forfeit",
      matchFinished: true,
      matchWinnerTeamId: winnerTeamId,
      nextRoundEligibleAt: null,
    };
  }

  return {
    ...match,
    pendingForfeitTeamId: null,
    leaveTerminationReason: null,
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
  const shouldTakeover = Boolean(
    player &&
      !isOkeyBotControlled(player) &&
      (current.timeoutCountsByPlayerId?.[player.id] ?? 0) >=
        OKEY_DRAW_TIMEOUT_TAKEOVER_THRESHOLD,
  );

  if (player && shouldTakeover) {
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
  const shouldTakeover = !isOkeyBotControlled(player);

  const takeoverMatch = reconcileAuthoritativeHumanControl({
    ...match,
    manualLeftPlayerIds,
    roundState: shouldTakeover
      ? handSeatToBot(
          match.roundState,
          actorPlayerIndex,
          "normal",
        )
      : match.roundState,
  });

  return takeoverMatch;
}
export function applyAuthoritativeOkeyMatchCommand(
  match:
    OkeyAuthoritativeMatchState,

  actorPlayerIndex: number,

  command:
    OkeyAuthoritativeCommand,
  now = Date.now(),
): OkeyAuthoritativeMatchState {
  if (match.matchFinished) {
    throw new OkeyCommandError("command_rejected");
  }
  
  if (command.type !== "take-back-seat" && isOkeyRoundStartPending(match, now)) {
    throw new OkeyCommandError("command_rejected");
  }

  const actor = match.roundState.players[actorPlayerIndex];
  if (command.type === "take-back-seat" && (match.manualLeftPlayerIds ?? []).includes(actor?.id)) {
    throw new OkeyCommandError("command_rejected");
  }

  const nextRoundState =
    applyAuthoritativeOkeyCommand(
      match.roundState,
      actorPlayerIndex,
      command,
    );

  const nextActor = nextRoundState.players[actorPlayerIndex];

  // The persisted field keeps its historical name for snapshot compatibility,
  // but now tracks consecutive DRAW-phase timeouts only. A successful Human
  // draw or explicit take-back-seat clears that streak.
  const nextTimeoutCounts =
    (command.type === "draw" || command.type === "take-back-seat") && nextActor && !isOkeyBotControlled(nextActor)
      ? {
          ...(match.timeoutCountsByPlayerId ?? {}),
          [nextActor.id]: 0,
        }
      : match.timeoutCountsByPlayerId;

  return reconcileAuthoritativeBotOwnership(
    settleAuthoritativeOkeyRound({
      ...match,
      timeoutCountsByPlayerId:
        nextTimeoutCounts,
      roundState:
        nextRoundState,
    }, now),
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function deriveOkeyDailyQuestGameplayEvents(
  previous: OkeyAuthoritativeMatchState,
  next: OkeyAuthoritativeMatchState,
  actorPlayerIndex: number,
  command: OkeyAuthoritativeCommand | {
    type: "manual-leave" | "system-timeout" | "system-eliminated-turn" | "start-next-round";
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

    if ((command.type === "open-melds" || command.type === "open-and-discard") && !actorBefore.opened && actorAfter.opened) {
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

  const isDrawTimeout =
    !match.roundState.hasDrawnThisTurn;

  const timeoutCounts =
    match.timeoutCountsByPlayerId ?? {};

  const currentStreak = timeoutCounts[player.id] ?? 0;
  const timeoutCount = isDrawTimeout ? currentStreak + 1 : currentStreak;

  const timeoutProgress = {
    shouldTakeOver:
      isDrawTimeout &&
      timeoutCount >= OKEY_DRAW_TIMEOUT_TAKEOVER_THRESHOLD,
  };

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
const takeoverRoundState =
  timeoutProgress.shouldTakeOver
    ? handSeatToBot(
        nextRoundState,
        playerIndex,
        "normal",
      )
    : nextRoundState;


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
    roundState: takeoverRoundState,
  }),
);
}

export function isOkeyRoundStartPending(
  match: OkeyAuthoritativeMatchState,
  now = Date.now(),
): boolean {
  const roundStartsAtMs = Date.parse(match.roundStartsAt ?? "");
  return Number.isFinite(roundStartsAtMs) && now < roundStartsAtMs;
}
export function getNextOkeyMatchTurnDeadline(
  match:
    OkeyAuthoritativeMatchState,

  now = Date.now(),
): string | null {
  if (match.matchFinished) {
    return null;
  }

  const context = getAuthoritativeOkeyTurnContext(match.roundState);

  if (context.controller !== "human") {
    return null;
  }

  const configuredStartMs = Date.parse(match.roundStartsAt ?? "");
  const deadlineBaseMs = Number.isFinite(configuredStartMs)
    ? Math.max(now, configuredStartMs)
    : now;

  return deriveAuthoritativeOkeyTurnDeadline({
    phase: context.phase,
    controller: context.controller,
    now: deadlineBaseMs,
  });
}

export function applyAuthoritativeOkeyEliminatedTurn(
  match: OkeyAuthoritativeMatchState,
  expectedActorId: string,
): OkeyAuthoritativeMatchState {
  if (match.matchFinished || match.roundState.phase !== "playing" || isOkeyRoundStartPending(match)) {
    throw new OkeyCommandError("command_rejected");
  }

  const actor =
    match.roundState.players[match.roundState.currentPlayerIndex];
  if (!isEliminatedOkeyPlayer(actor) || actor.id !== expectedActorId) {
    throw new OkeyCommandError("command_rejected");
  }

  const nextRoundState = playEliminatedTurn(match.roundState);
  if (nextRoundState === match.roundState) {
    throw new OkeyCommandError("command_rejected");
  }

  return settleAuthoritativeOkeyRound({
    ...match,
    roundState: nextRoundState,
  });
}

export function getOkeyMatchTurnDeadlineAfterTransition(
  previousMatch: OkeyAuthoritativeMatchState,
  nextMatch: OkeyAuthoritativeMatchState,
  currentDeadline: string | null,
  now = Date.now(),
): string | null {
  const nextDeadline = getNextOkeyMatchTurnDeadline(nextMatch, now);
  if (!nextDeadline) return null;

  const previousPlayer =
    previousMatch.roundState.players[previousMatch.roundState.currentPlayerIndex];
  const nextPlayer =
    nextMatch.roundState.players[nextMatch.roundState.currentPlayerIndex];
  const sameTurn =
    previousMatch.currentRound === nextMatch.currentRound &&
    previousMatch.roundState.currentPlayerIndex ===
      nextMatch.roundState.currentPlayerIndex &&
    previousPlayer?.id === nextPlayer?.id;

  const enteredThrowPhase =
    sameTurn &&
    !previousMatch.roundState.hasDrawnThisTurn &&
    nextMatch.roundState.hasDrawnThisTurn;

  return sameTurn && !enteredThrowPhase && currentDeadline
    ? currentDeadline
    : nextDeadline;
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

    turnDurationSeconds:
      state.hasDrawnThisTurn
        ? OKEY_THROW_PHASE_SECONDS
        : OKEY_DRAW_PHASE_SECONDS,
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
      OKEY_RULESET_V1.match.roundCount,

    roundResults:
      match.roundResults,

    matchScores:
      match.matchScores,

    matchFinished:
      match.matchFinished,

    matchWinnerTeamId:
      match.matchWinnerTeamId,

    forcedKonkanTeamId:
      match.forcedKonkanTeamId ?? null,

    roundStartsAt:
      match.roundStartsAt ?? null,

    nextRoundEligibleAt:
      match.nextRoundEligibleAt ?? null,

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



/**
 * The one reducer set consumed by the authoritative turn engine.
 *
 * Runtime entry points import this set instead of composing match-state
 * transitions themselves. The reducers below intentionally reuse the existing
 * rule functions so gameplay behavior is unchanged while ownership moves into
 * the central engine boundary.
 */
export const OKEY_AUTHORITATIVE_TRANSITION_REDUCERS: OkeyAuthoritativeTransitionReducers<
  OkeyAuthoritativeMatchState,
  OkeyAuthoritativeCommand,
  OkeyGameState
> = {
  applyHumanCommand: (state, actorPlayerIndex, command, now) =>
    applyAuthoritativeOkeyMatchCommand(state, actorPlayerIndex, command, now),
  applyManualLeave: (state, actorPlayerIndex) =>
    applyAuthoritativeManualLeave(state, actorPlayerIndex),
  applyTimeout: (state, deadlineAt, now) =>
    resolveAuthoritativeMatchDeadline(state, deadlineAt, now),
  applyEliminatedTurn: (state, expectedActorId) =>
    applyAuthoritativeOkeyEliminatedTurn(state, expectedActorId),
  startNextRound: (state, now) =>
    startAuthoritativeOkeyNextRound(state, now),
  applyBotRoundState: (state, roundState, now) =>
    settleAuthoritativeOkeyRound({ ...state, roundState }, now),
};
