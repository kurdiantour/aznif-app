import type { OkeyColor, OkeyTeamId } from "../types/okey.ts";

export const OKEY_RULESET_V1 = {
  id: "team-konkan-101",
  version: 1,
  status: "implemented-baseline",
  tiles: {
    colors: ["red", "blue", "black", "yellow"] as const satisfies readonly OkeyColor[],
    minimumValue: 1,
    maximumValue: 13,
    copiesPerTile: 2,
    fakeJokerCount: 2,
  },
  table: {
    playerCount: 4,
    teamIds: ["teamA", "teamB"] as const satisfies readonly OkeyTeamId[],
    seatTeamIds: ["teamA", "teamB", "teamA", "teamB"] as const satisfies readonly OkeyTeamId[],
    counterClockwiseTurnOrder: [0, 1, 2, 3] as const,
  },
  hand: {
    dealerInitialSize: 15,
    playerInitialSize: 14,
    basicWinningSize: 14,
  },
  meld: {
    minimumSize: 3,
    maximumRunSize: 13,
    maximumSetSize: 4,
    maximumPlayerMelds: 7,
    forbidTwoWildcardsInThreeTileMeld: true,
    allowAscendingRuns: true,
    allowDescendingRuns: true,
    allowAceAfterThirteen: true,
  },
  opening: {
    initialMinimumScore: 81,
    teammateMinimumScore: 61,
    opponentFirstOpenIncrement: 1,
    pairMode: false,
  },
  drawPile: {
    maximumReshuffles: 3,
    preserveTopDiscardOnReshuffle: true,
    repeatRoundWithSameDealerAtCycleLimit: true,
  },
  konkan: {
    officialRunSize: 10,
    completionMeldMinimumSize: 3,
    completionMeldMaximumSize: 4,
    maximumRestrictedDiscardPicks: 2,
    maximumLocksPerPlayer: 1,
    officialRunPatterns: [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      [4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      [1, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    ] as const,
  },
  scoring: {
    cappedTileMinimumValue: 10,
    cappedTileScore: 10,
    naturalJokerInHand: 25,
    stolenJokerInHand: 2,
    unopenedOpponentPenalty: 100,
    openedOpponentKonkanBonus: 100,
    unopenedOpponentKonkanPenalty: 200,
    lowerMatchScoreWins: true,
  },
  match: {
    roundCount: 7,
    determineRound: 7,
    normalRecoveryPoints: 200,
    konkanRecoveryPoints: 400,
    forceKonkanAnnouncementMs: 5_000,
    nextRoundDealer: "previous-round-winner",
    cycleLimitDealer: "same-dealer",
    tiedLowestScoreHasNoWinner: true,
  },
} as const;

export type OkeyRulesetV1 = typeof OKEY_RULESET_V1;

