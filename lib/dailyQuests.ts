import { supabase } from "./supabase";

export type DailyQuestRewardType = "coin" | "gem" | "mc";

export type DailyQuest = {
  instanceId: string;
  definitionCode: string;
  gameType: "domino" | "okey";
  metric: string;
  title: string;
  description: string | null;
  target: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  canClaim: boolean;
  rewardType: DailyQuestRewardType;
  rewardAmount: number;
  sortOrder: number;
};

export type DailyQuestsStatus = {
  serverDate: string;
  nextResetAt: string;
  quests: DailyQuest[];
};

export type DailyQuestClaimResult = {
  claimId: string;
  instanceId: string;
  alreadyClaimed: boolean;
  rewardType: DailyQuestRewardType;
  rewardAmount: number;
  balanceBefore: number;
  balanceAfter: number;
  dailyQuests: DailyQuestsStatus;
};

function parseStatus(value: unknown): DailyQuestsStatus {
  const row = value as Partial<DailyQuestsStatus> | null;
  if (!row || typeof row.serverDate !== "string" ||
      typeof row.nextResetAt !== "string" || !Array.isArray(row.quests)) {
    throw new Error("Invalid Daily Quests response");
  }

  const quests = row.quests.map((value) => {
    const quest = value as Partial<DailyQuest>;
    if (typeof quest.instanceId !== "string" || typeof quest.title !== "string" ||
        typeof quest.metric !== "string" ||
        (quest.gameType !== "domino" && quest.gameType !== "okey") ||
        typeof quest.target !== "number" || !Number.isFinite(quest.target) || quest.target <= 0 ||
        typeof quest.progress !== "number" || !Number.isFinite(quest.progress) ||
        typeof quest.completed !== "boolean" || typeof quest.claimed !== "boolean" ||
        typeof quest.canClaim !== "boolean" ||
        !["coin", "gem", "mc"].includes(String(quest.rewardType)) ||
        typeof quest.rewardAmount !== "number" || !Number.isFinite(quest.rewardAmount)) {
      throw new Error("Invalid Daily Quest item");
    }
    return quest as DailyQuest;
  });

  return { serverDate: row.serverDate, nextResetAt: row.nextResetAt, quests };
}

export async function getDailyQuests(): Promise<DailyQuestsStatus> {
  const { data, error } = await supabase.rpc("get_daily_quests");
  if (error) throw error;
  return parseStatus(data);
}

export async function claimDailyQuestReward(instanceId: string): Promise<DailyQuestClaimResult> {
  const { data, error } = await supabase.rpc("claim_daily_quest_reward", {
    p_quest_instance_id: instanceId,
  });
  if (error) throw error;
  const row = data as Partial<DailyQuestClaimResult> | null;
  if (!row || typeof row.claimId !== "string" || typeof row.instanceId !== "string" ||
      typeof row.alreadyClaimed !== "boolean" || !row.dailyQuests) {
    throw new Error("Invalid Daily Quest claim response");
  }
  return { ...row, dailyQuests: parseStatus(row.dailyQuests) } as DailyQuestClaimResult;
}

