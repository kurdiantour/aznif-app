import { useEffect, useState } from "react";
import { getCachedShopState, getMyShopState, subscribeShopChanges } from "@/lib/shop";
import { nextShopBoundaryDelay, projectShopState } from "@/lib/shop-state";
import { useUserResource } from "./useUserResource";

export function useShopState(enabled = true) {
  const { data, error, loading, refresh, allowed } = useUserResource(getMyShopState, enabled, undefined, getCachedShopState);
  const [projection, setProjection] = useState<{ source: typeof data; elapsed: number } | null>(null);
  useEffect(() => {
    if (!allowed) return;
    return subscribeShopChanges(() => { void refresh(); });
  }, [allowed, refresh]);
  useEffect(() => {
    if (!allowed || !data) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const projectAndSchedule = (atBoundary: boolean) => {
      if (cancelled) return;
      const elapsed = performance.now() - data.receivedAt;
      setProjection({ source: data, elapsed });
      if (atBoundary) void refresh();
      const delay = nextShopBoundaryDelay(data, elapsed);
      if (delay !== null) {
        timer = setTimeout(() => projectAndSchedule(true), Math.min(delay + 1, 2147483647));
      }
    };
    // Re-project on resume even if the refresh fails and every boundary has passed.
    void Promise.resolve().then(() => projectAndSchedule(false));
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [allowed, data, refresh]);
  const state = data ? projectShopState(data, (projection?.source === data ? projection.elapsed : 0)) : null;
  return { state, error: error?.message ?? null, loading, refresh };
}
