type TeamId = "teamA" | "teamB";
type MatchPerformanceTier = "close" | "normal" | "dominating";

type MatchReward = {
  tier: MatchPerformanceTier;
  gold: number;
  points: number;
};

export const MATCH_TARGET_SCORE = 350;

const MATCH_REWARD_RULES: Array<{
  tier: MatchPerformanceTier;
  maxDifference: number;
  gold: number;
  points: number;
}> = [
  { tier: "close", maxDifference: 50, gold: 3, points: 10 },
  { tier: "normal", maxDifference: 150, gold: 6, points: 20 },
  {
    tier: "dominating",
    maxDifference: Number.POSITIVE_INFINITY,
    gold: 9,
    points: 30,
  },
];

export function calculateMatchReward(
  winnerScore: number,
  loserScore: number,
): MatchReward {
  const difference = Math.max(0, winnerScore - loserScore);
  const rule =
    MATCH_REWARD_RULES.find((item) => difference <= item.maxDifference) ??
    MATCH_REWARD_RULES[2];

  return {
    tier: rule.tier,
    gold: rule.gold,
    points: rule.points,
  };
}

export function getFinalMatchWinner(
  scores: Record<TeamId, number>,
): TeamId | null {
  const teamAReachedTarget = scores.teamA >= MATCH_TARGET_SCORE;
  const teamBReachedTarget = scores.teamB >= MATCH_TARGET_SCORE;

  if (!teamAReachedTarget && !teamBReachedTarget) return null;
  if (teamAReachedTarget && !teamBReachedTarget) return "teamA";
  if (teamBReachedTarget && !teamAReachedTarget) return "teamB";

  if (scores.teamA > scores.teamB) return "teamA";
  if (scores.teamB > scores.teamA) return "teamB";

  return null;
}

export function resolveMatchOutcome(
  scores: Record<TeamId, number>,
  existingReward?: MatchReward | null,
) {
  const winningTeamId = getFinalMatchWinner(scores);

  if (!winningTeamId) {
    return { winningTeamId: null, matchReward: null };
  }

  const winnerScore = Number(scores[winningTeamId] ?? 0);
  const loserScore =
    winningTeamId === "teamA"
      ? Number(scores.teamB ?? 0)
      : Number(scores.teamA ?? 0);

  return {
    winningTeamId,
    matchReward:
      existingReward ?? calculateMatchReward(winnerScore, loserScore),
  };
}
