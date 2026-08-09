import {
  createInitialOkeyGame,
  getMatchWinnerTeamId,
  getRoundResultScoreDetails,
} from "@/okey/engine/okey-engine";
import { OKEY_RULESET_V1 } from "@/okey/rules/okey-ruleset-v1";
import type {
  OkeyColor,
  OkeyGameState,
  OkeyMeld,
  OkeyPlayer,
  OkeyTeamId,
  OkeyTile,
} from "@/okey/types/okey";
export const OKEY_SAVE_VERSION = 3;
const PLAYER_COUNT = OKEY_RULESET_V1.table.playerCount;
export const MAX_ROUNDS = OKEY_RULESET_V1.match.roundCount;
export const ROUND_RESULT_COUNTDOWN_SECONDS = 5;
const TEAM_IDS: OkeyTeamId[] = [...OKEY_RULESET_V1.table.teamIds];
const TILE_COLORS: OkeyColor[] = [...OKEY_RULESET_V1.tiles.colors];

type RoundScoreDetails = ReturnType<typeof getRoundResultScoreDetails>;

export type OkeyRoundResult = {
  round: number;
  scoreDetails: RoundScoreDetails;
  winnerId: string | null;
  winnerTeamId: OkeyTeamId | null;
  endReason: OkeyGameState["endReason"];
};

export type OkeyMatchState = {
  roundState: OkeyGameState;
  currentRound: number;
  roundResults: OkeyRoundResult[];
  matchScores: Record<OkeyTeamId, number>;
  showRoundResultPopup: boolean;
  showFinishRevealPopup: boolean;
  roundResultCountdownRemaining: number | null;
  matchWinnerTeamId: OkeyTeamId | null;
  matchFinished: boolean;
  showMatchResultPopup: boolean;
};

export function createInitialOkeyMatch(): OkeyMatchState {
  return {
    roundState: createInitialOkeyGame(),
    currentRound: 1,
    roundResults: [],
    matchScores: { teamA: 0, teamB: 0 },
    showRoundResultPopup: false,
    showFinishRevealPopup: false,
    roundResultCountdownRemaining: null,
    matchWinnerTeamId: null,
    matchFinished: false,
    showMatchResultPopup: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withSavedDealerIndex(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const discardPileLength = Array.isArray(value.discardPile) ? value.discardPile.length : 0;
  return {
    ...value,
    dealerIndex: typeof value.dealerIndex === "number"
      ? value.dealerIndex
      : typeof value.currentPlayerIndex === "number"
        ? value.currentPlayerIndex
        : value.dealerIndex,
    discardOwners: Array.isArray(value.discardOwners)
      ? value.discardOwners
      : Array.from({ length: discardPileLength }, () => null),
    konkanDiscardPickCounts: isRecord(value.konkanDiscardPickCounts)
      ? value.konkanDiscardPickCounts
      : {},
    mustFinishAfterSecondKonkanDiscardPickPlayerId:
      typeof value.mustFinishAfterSecondKonkanDiscardPickPlayerId === "string"
        ? value.mustFinishAfterSecondKonkanDiscardPickPlayerId
        : null,
    players: Array.isArray(value.players)
      ? value.players.map((player) => isRecord(player) ? { ...player, pendingKonkanFromDiscard: typeof player.pendingKonkanFromDiscard === "boolean" ? player.pendingKonkanFromDiscard : false } : player)
      : value.players,
  };
}

function withSavedMatchDealerIndex(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return { ...value, roundState: withSavedDealerIndex(value.roundState) };
}
function isOkeyTile(value: unknown): value is OkeyTile {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.color === "string" && TILE_COLORS.some((color) => color === value.color) && typeof value.value === "number" && Number.isFinite(value.value) && (value.copy === 1 || value.copy === 2) && (value.isFakeJoker === undefined || typeof value.isFakeJoker === "boolean") && (value.jokerOrigin === undefined || value.jokerOrigin === "natural" || value.jokerOrigin === "stolen");
}

function isOkeyMeld(value: unknown): value is OkeyMeld {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.ownerId === "string" && (value.kind === "run" || value.kind === "set") && Array.isArray(value.tiles) && value.tiles.every(isOkeyTile) && typeof value.score === "number" && Number.isFinite(value.score) && (value.locked === undefined || typeof value.locked === "boolean") && (value.lockedByPlayerId === undefined || typeof value.lockedByPlayerId === "string") && (value.lockedTileId === undefined || typeof value.lockedTileId === "string") && (value.originalOwnerPlayerId === undefined || typeof value.originalOwnerPlayerId === "string");
}

function isOkeyPlayer(value: unknown): value is OkeyPlayer {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.name === "string" && (value.kind === "human" || value.kind === "bot") && (value.botNumber === undefined || (typeof value.botNumber === "number" && Number.isInteger(value.botNumber) && value.botNumber >= 300)) && typeof value.teamId === "string" && TEAM_IDS.includes(value.teamId as OkeyTeamId) && Array.isArray(value.hand) && value.hand.every(isOkeyTile) && typeof value.opened === "boolean" && Array.isArray(value.melds) && value.melds.every(isOkeyMeld) && typeof value.scoreOpened === "number" && Number.isFinite(value.scoreOpened) && typeof value.konkan === "boolean" && (value.konkanEntryReason === null || value.konkanEntryReason === "discard-pick" || value.konkanEntryReason === "forced-table-add" || value.konkanEntryReason === "joker-replacement") && (value.pendingKonkanFromDiscard === undefined || typeof value.pendingKonkanFromDiscard === "boolean") && (value.eliminated === undefined || typeof value.eliminated === "boolean");
}

function isTeamScores(value: unknown): value is Record<OkeyTeamId, number> {
  if (!isRecord(value)) return false;
  return TEAM_IDS.every((teamId) => typeof value[teamId] === "number" && Number.isFinite(value[teamId]));
}

function isTeamFirstOpenScores(value: unknown): value is Record<OkeyTeamId, number | null> {
  if (!isRecord(value)) return false;
  return TEAM_IDS.every((teamId) => {
    const score = value[teamId];
    return score === null || (typeof score === "number" && Number.isFinite(score));
  });
}

function isValidSavedOkeyGameState(value: unknown): value is OkeyGameState {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.players) || value.players.length !== PLAYER_COUNT || !value.players.every(isOkeyPlayer)) return false;
  if (value.players[0]?.kind !== "human" || value.players.slice(1).some((player) => player.kind !== "bot")) return false;
  if (!Array.isArray(value.stagingMelds) || !value.stagingMelds.every(isOkeyMeld)) return false;
  if (!isTeamFirstOpenScores(value.teamFirstOpenScores)) return false;
  if (typeof value.currentPlayerIndex !== "number" || !Number.isInteger(value.currentPlayerIndex) || value.currentPlayerIndex < 0 || value.currentPlayerIndex >= PLAYER_COUNT) return false;
  if (typeof value.dealerIndex !== "number" || !Number.isInteger(value.dealerIndex) || value.dealerIndex < 0 || value.dealerIndex >= PLAYER_COUNT) return false;
  if (!Array.isArray(value.deck) || !value.deck.every(isOkeyTile)) return false;
  if (!Array.isArray(value.discardPile) || !value.discardPile.every(isOkeyTile)) return false;
  if (!Array.isArray(value.discardOwners) || value.discardOwners.length !== value.discardPile.length) return false;
  if (!value.discardOwners.every((owner) => owner === null || (isRecord(owner) && typeof owner.playerIndex === "number" && Number.isInteger(owner.playerIndex) && owner.playerIndex >= 0 && owner.playerIndex < PLAYER_COUNT && typeof owner.playerId === "string"))) return false;
  if (!isRecord(value.konkanDiscardPickCounts) || !Object.values(value.konkanDiscardPickCounts).every((count) => typeof count === "number" && Number.isInteger(count) && count >= 0)) return false;
  if (value.mustFinishAfterSecondKonkanDiscardPickPlayerId !== null && typeof value.mustFinishAfterSecondKonkanDiscardPickPlayerId !== "string") return false;
  if (typeof value.reshuffleCount !== "number" || !Number.isFinite(value.reshuffleCount)) return false;
  if (!isOkeyTile(value.indicatorTile) || !isOkeyTile(value.okeyTile)) return false;
  if (value.phase !== "playing" && value.phase !== "finished") return false;
  if (value.winnerId !== null && typeof value.winnerId !== "string") return false;
  if (value.endReason !== null && value.endReason !== "win" && value.endReason !== "tile-cycle-limit") return false;
  if (!isRecord(value.turnMessage) || typeof value.turnMessage.code !== "string" || typeof value.hasDrawnThisTurn !== "boolean") return false;
  return true;
}

function isRoundResult(value: unknown): value is OkeyRoundResult {
  if (!isRecord(value)) return false;
  if (typeof value.round !== "number" || !Number.isInteger(value.round) || value.round < 1 || value.round > MAX_ROUNDS) return false;
  if (!isRecord(value.scoreDetails) || !isTeamScores(value.scoreDetails.scores) || !Array.isArray(value.scoreDetails.details)) return false;
  if (value.winnerId !== null && typeof value.winnerId !== "string") return false;
  if (value.winnerTeamId !== null && !TEAM_IDS.includes(value.winnerTeamId as OkeyTeamId)) return false;
  return value.endReason === null || value.endReason === "win" || value.endReason === "tile-cycle-limit";
}

function isValidSavedOkeyMatch(value: unknown): value is OkeyMatchState {
  if (!isRecord(value)) return false;
  return isValidSavedOkeyGameState(value.roundState) && typeof value.currentRound === "number" && Number.isInteger(value.currentRound) && value.currentRound >= 1 && value.currentRound <= MAX_ROUNDS && Array.isArray(value.roundResults) && value.roundResults.every(isRoundResult) && value.roundResults.length <= MAX_ROUNDS && isTeamScores(value.matchScores) && typeof value.showRoundResultPopup === "boolean" && (value.showFinishRevealPopup === undefined || typeof value.showFinishRevealPopup === "boolean") && (value.roundResultCountdownRemaining === null || (typeof value.roundResultCountdownRemaining === "number" && Number.isInteger(value.roundResultCountdownRemaining) && value.roundResultCountdownRemaining >= 0 && value.roundResultCountdownRemaining <= ROUND_RESULT_COUNTDOWN_SECONDS)) && (value.matchWinnerTeamId === null || TEAM_IDS.includes(value.matchWinnerTeamId as OkeyTeamId)) && typeof value.matchFinished === "boolean" && (value.showMatchResultPopup === undefined || typeof value.showMatchResultPopup === "boolean");
}

export function parseSavedOkeyMatch(raw: string | null): OkeyMatchState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: number; match?: unknown; state?: unknown };
    const savedMatch = withSavedMatchDealerIndex(parsed.match);
    if (parsed.version === OKEY_SAVE_VERSION && isValidSavedOkeyMatch(savedMatch)) return { ...savedMatch, showFinishRevealPopup: savedMatch.showFinishRevealPopup ?? false, showMatchResultPopup: savedMatch.showMatchResultPopup ?? false };
    const savedState = withSavedDealerIndex(parsed.state);
    if (parsed.version === 1 && isValidSavedOkeyGameState(savedState)) {
      return { ...createInitialOkeyMatch(), roundState: savedState };
    }
    return null;
  } catch (error) {
    console.warn("Unable to parse saved Okey match", error);
    return null;
  }
}

export function settleFinishedRound(match: OkeyMatchState): OkeyMatchState {
  if (match.roundState.phase !== "finished") return match;
  if (match.roundState.endReason === "tile-cycle-limit") {
    return {
      ...match,
      showFinishRevealPopup: false,
      showRoundResultPopup: true,
      roundResultCountdownRemaining: match.roundResultCountdownRemaining ?? ROUND_RESULT_COUNTDOWN_SECONDS,
    };
  }
  if (match.roundResults.some((result) => result.round === match.currentRound)) return match;

  const scoreDetails = getRoundResultScoreDetails(match.roundState);
  const winner = match.roundState.players.find((player) => player.id === match.roundState.winnerId);
  const winnerTeamId = winner?.teamId ?? null;
  const nextScores = {
    teamA: match.matchScores.teamA + scoreDetails.scores.teamA,
    teamB: match.matchScores.teamB + scoreDetails.scores.teamB,
  };
  const matchFinished = match.currentRound >= MAX_ROUNDS;
  const matchWinnerTeamId = matchFinished
    ? getMatchWinnerTeamId(nextScores)
    : null;

  return {
    ...match,
    roundResults: [
      ...match.roundResults,
      {
        round: match.currentRound,
        scoreDetails,
        winnerId: match.roundState.winnerId,
        winnerTeamId,
        endReason: match.roundState.endReason,
      },
    ],
    matchScores: nextScores,
    showFinishRevealPopup: true,
    showRoundResultPopup: false,
    roundResultCountdownRemaining: null,
    matchFinished,
    matchWinnerTeamId,
  };
}

