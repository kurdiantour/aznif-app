import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { claimDailyQuestReward, getDailyQuests, type DailyQuestsStatus } from "@/lib/dailyQuests";
import { notifyWalletRefresh } from "@/lib/walletEvents";

export function useDailyQuests() {
  const [status, setStatus] = useState<DailyQuestsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const claimInFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getDailyQuests();
      setStatus(next);
      setError(null);
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const claim = useCallback(async (instanceId: string) => {
    if (claimInFlight.current) return null;
    const quest = status?.quests.find((item) => item.instanceId === instanceId);
    if (!quest?.canClaim) return null;
    claimInFlight.current = true;
    setClaimingId(instanceId);
    try {
      const result = await claimDailyQuestReward(instanceId);
      setStatus(result.dailyQuests);
      setError(null);
      notifyWalletRefresh();
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
      return null;
    } finally {
      claimInFlight.current = false;
      setClaimingId(null);
    }
  }, [status?.quests]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (!status?.nextResetAt) return;
    const delay = new Date(status.nextResetAt).getTime() - Date.now() + 1_000;
    if (!Number.isFinite(delay) || delay <= 0) { void refresh(); return; }
    const timeout = setTimeout(() => void refresh(), Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timeout);
  }, [refresh, status?.nextResetAt]);

  const claimableCount = status?.quests.filter((quest) => quest.canClaim).length ?? 0;
  return { status, loading, claimingId, error, claimableCount, refresh, claim };
}

