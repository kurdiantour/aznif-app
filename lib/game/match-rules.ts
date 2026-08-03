type TeamId = "teamA" | "teamB";

type MatchReward = {
  coin: number;
  gem: number;
  points: number;
};

export const MATCH_TARGET_SCORE = 350;

export const FREE_MATCH_WIN_REWARD: MatchReward = {
  coin: 20,
  gem: 5,
  points: 25,
};

export const FREE_MATCH_LOSS_REWARD: MatchReward = {
  coin: 5,
  gem: 0,
  points: -15,
};

export function calculateMatchReward(
  _winnerScore: number,
  _loserScore: number,
): MatchReward {
  return { ...FREE_MATCH_WIN_REWARD };
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

  return {
    winningTeamId,
    matchReward: existingReward ?? calculateMatchReward(0, 0),
  };
}
