import { supabase } from "./supabase";

export type DailyGiftCardStatus = "done" | "current" | "lock";
export type DailyGiftStatus = {
  serverDate: string;
  nextResetAt: string;
  currentDay: number | null;
  canClaim: boolean;
  claimedToday: boolean;
  statuses: DailyGiftCardStatus[];
};
export type DailyGiftClaimResult = DailyGiftStatus & {
  claimId: string;
  alreadyClaimed: boolean;
  awardedDay: number;
  rewardType?: "coin" | "gem" | "mc" | "special_chest";
  rewardAmount?: number;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
};

function parseStatus(value: unknown): DailyGiftStatus {
  const row = value as Partial<DailyGiftStatus> | null;
  const statuses = Array.isArray(row?.statuses) ? row.statuses : [];
  if (!row || typeof row.serverDate !== "string" ||
      typeof row.nextResetAt !== "string" || typeof row.canClaim !== "boolean" ||
      typeof row.claimedToday !== "boolean" || statuses.length !== 7 ||
      !statuses.every((item) => item === "done" || item === "current" || item === "lock")) {
    throw new Error("Invalid Daily Gift response");
  }
  return {
    serverDate: row.serverDate,
    nextResetAt: row.nextResetAt,
    currentDay: typeof row.currentDay === "number" ? row.currentDay : null,
    canClaim: row.canClaim,
    claimedToday: row.claimedToday,
    statuses: statuses as DailyGiftCardStatus[],
  };
}

export async function getDailyGiftStatus(): Promise<DailyGiftStatus> {
  const { data, error } = await supabase.rpc("get_daily_gift_status");
  if (error) throw error;
  return parseStatus(data);
}

export async function claimDailyGift(): Promise<DailyGiftClaimResult> {
  const { data, error } = await supabase.rpc("claim_daily_gift");
  if (error) throw error;
  const status = parseStatus(data);
  const row = data as Partial<DailyGiftClaimResult>;
  if (typeof row.claimId !== "string" || typeof row.alreadyClaimed !== "boolean" ||
      typeof row.awardedDay !== "number") {
    throw new Error("Invalid Daily Gift claim response");
  }
  return { ...row, ...status } as DailyGiftClaimResult;
}

export type OpenChestResult = {
  success: boolean;
  awardedCoins: number;
  awardedGems: number;
  awardedMc: number;
  playerLevel: number;
  balances: {
    coinBefore: number;
    coinAfter: number;
    gemBefore: number;
    gemAfter: number;
    mcBefore: number;
    mcAfter: number;
  };
};

export async function openSpecialChest(): Promise<OpenChestResult> {
  const { data, error } = await supabase.rpc("open_special_chest");
  if (error) throw error;
  return data as OpenChestResult;
}
