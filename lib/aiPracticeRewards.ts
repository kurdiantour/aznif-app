import { supabase } from './supabase';

export type AiPracticeRewardClaim = {
  claim_id: string | null;
  user_id: string;
  points: number;
  already_claimed: boolean;
};

export async function awardAiPracticeWin(
  practiceMatchId: string,
): Promise<AiPracticeRewardClaim | null> {
  console.log('[AI practice reward] awardAiPracticeWin entered', {
    practiceMatchId,
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();

  console.log('[AI practice reward] auth state before RPC', {
    userId: authData.user?.id ?? null,
    authError,
  });

  const { data, error } = await supabase.rpc('award_ai_practice_win', {
    p_practice_match_id: practiceMatchId,
  });

  console.log('[AI practice reward] RPC result data', data);
  console.log('[AI practice reward] RPC error', error);

  if (error) {
    throw error;
  }

  const claim = Array.isArray(data) ? data[0] : data;

  if (!claim) {
    console.log('[AI practice reward] RPC returned no claim row');
    return null;
  }

  const mappedClaim: AiPracticeRewardClaim = {
    claim_id: claim.claim_id ?? null,
    user_id: claim.rewarded_user_id ?? claim.user_id,
    points: Number(claim.awarded_points ?? claim.points ?? 0),
    already_claimed: Boolean(claim.already_claimed),
  };

  console.log('[AI practice reward] mapped claim', mappedClaim);

  return mappedClaim;
}