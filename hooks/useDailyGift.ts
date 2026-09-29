import { hasReadySession } from "@/lib/auth-state";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDailyGiftStatus, claimDailyGift } from "@/lib/dailyGift";
import { notifyWalletRefresh } from "@/lib/walletEvents";
import { useUserResource } from "./useUserResource";

export function useDailyGift() {
  const { data: status, error: loadError, loading, refresh, accept, current, generation } = useUserResource(getDailyGiftStatus);
  const [mutation, setMutation] = useState<{ generation: number; id: string | null; error: Error | null } | null>(null);
  const inFlight = useRef<number | null>(null);
  const claim = useCallback(async () => {
    if (!current() || !hasReadySession() || inFlight.current === generation || !status?.canClaim) return null;
    inFlight.current = generation;
    setMutation({ generation, id: "gift", error: null });
    try {
      const result = await claimDailyGift();
      if (!current()) return null;
      accept(result);
      notifyWalletRefresh();
      return result;
    } catch (cause) {
      if (current()) setMutation({ generation, id: null, error: cause instanceof Error ? cause : new Error(String((cause as { message?: string })?.message ?? cause)) });
      return null;
    } finally {
      if (inFlight.current === generation) inFlight.current = null;
      if (current()) setMutation((previous) => previous?.generation === generation ? { ...previous, id: null } : previous);
    }
  }, [current, generation, status, accept]);
  useEffect(() => {
    if (!status?.nextResetAt) return;
    const delay = new Date(status.nextResetAt).getTime() - Date.now() + 1000;
    if (!Number.isFinite(delay)) return;
    const timer = setTimeout(() => { void refresh(); }, Math.min(Math.max(delay, 1000), 2147483647));
    return () => clearTimeout(timer);
  }, [status?.nextResetAt, refresh]);
  const ownMutation = mutation?.generation === generation ? mutation : null;
  const error = ownMutation?.error ?? loadError;
  return { status, loading, claiming: !!ownMutation?.id, error, refresh, claim };
}
