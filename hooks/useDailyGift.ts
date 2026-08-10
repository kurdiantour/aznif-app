import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  claimDailyGift,
  getDailyGiftStatus,
  type DailyGiftStatus,
} from "@/lib/dailyGift";
import { notifyWalletRefresh } from "@/lib/walletEvents";

export function useDailyGift() {
  const [status, setStatus] = useState<DailyGiftStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const claimInFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getDailyGiftStatus();
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

  const claim = useCallback(async () => {
    if (claimInFlight.current || !status?.canClaim) return null;

    claimInFlight.current = true;
    setClaiming(true);
    try {
      const result = await claimDailyGift();
      setStatus(result);
      setError(null);
      notifyWalletRefresh();
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
      return null;
    } finally {
      claimInFlight.current = false;
      setClaiming(false);
    }
  }, [status?.canClaim]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (!status?.nextResetAt) return;
    const delay = new Date(status.nextResetAt).getTime() - Date.now() + 1_000;
    if (!Number.isFinite(delay) || delay <= 0) {
      void refresh();
      return;
    }
    const timeout = setTimeout(() => void refresh(), Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timeout);
  }, [refresh, status?.nextResetAt]);

  return { status, loading, claiming, error, refresh, claim };
}
