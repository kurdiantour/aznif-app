import { supabase } from "@/lib/supabase";

export type AiPracticeRewardClaim = {
  claim_id: string | null;
  user_id: string;
  points: number;
  already_claimed: boolean;
};

/**
 * AI Practice reward policy
 *
 * This game mode is intentionally client-side and is designed as a lightweight
 * practice/fallback mode when no human opponent is available.
 *
 * Product decisions:
 *
 * - AI Practice matches are intentionally NOT server-authoritative.
 * - Players may play AI Practice an unlimited number of times per day.
 * - Each AI Practice win awards only +1 progression point.
 * - These points are not MC / wallet currency and have no direct monetary value.
 * - We intentionally do not add daily reward caps for this mode.
 * - A single practiceMatchId must not be rewarded more than once.
 *
 * Do not introduce server-side match validation or daily limits here unless
 * the reward model changes in the future (for example, MC, valuable currency,
 * paid rewards, or competitive prizes).
 *
 * The database RPC `award_ai_practice_win` remains responsible for validating
 * the authenticated user and preventing duplicate claims for the same match ID.
 */
export async function awardAiPracticeWin(
  practiceMatchId: string,
): Promise<AiPracticeRewardClaim | null> {
  const { data, error } = await supabase.rpc("award_ai_practice_win", {
    p_practice_match_id: practiceMatchId,
  });

  if (error) {
    throw error;
  }

  const claim = Array.isArray(data) ? data[0] : data;

  if (!claim) {
    return null;
  }

  return {
    claim_id: claim.claim_id ?? null,
    user_id: claim.rewarded_user_id ?? claim.user_id,
    points: Number(
      claim.awarded_points ?? claim.awarded_cup ?? claim.points ?? 0,
    ),
    already_claimed: Boolean(claim.already_claimed),
  };
}