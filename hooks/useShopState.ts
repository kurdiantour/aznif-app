import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getCachedShopState, getMyShopState, subscribeShopChanges } from "@/lib/shop";
import { nextShopBoundaryDelay, projectShopState } from "@/lib/shop-state";
import type { ShopState } from "@/lib/shop-types";
import { supabase } from "@/lib/supabase";

/** Shared personal shop lifecycle; callers opt out for room cosmetics. */
export function useShopState(enabled = true) {
  const [state, setState] = useState<ShopState | null>(() => enabled ? getCachedShopState() : null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const source = useRef<ShopState | null>(state);
  const generation = useRef(0);
  const mounted = useRef(false);

  const project = useCallback(() => {
    const current = source.current;
    if (current && mounted.current) setState(projectShopState(current, performance.now() - current.receivedAt));
  }, []);
  const refresh = useCallback(async () => {
    if (!enabled || !mounted.current) return;
    const request = ++generation.current;
    project();
    try {
      const next = await getMyShopState();
      if (!mounted.current || request !== generation.current) return;
      source.current = next;
      setError(null);
      project();
    } catch (cause) {
      if (!mounted.current || request !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Unable to load Shop");
      project();
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, [enabled, project]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) return () => { mounted.current = false; };
    let userId: string | null | undefined;
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => {
      if (userId === (session?.user.id ?? null)) return;
      userId = session?.user.id ?? null;
      generation.current++;
      source.current = getCachedShopState(userId);
      setState(source.current);
      // Leave the auth callback before calling another Supabase API.
      void Promise.resolve().then(refresh);
    });
    void refresh();
    const unsubscribe = subscribeShopChanges(() => { void refresh(); });
    const app = AppState.addEventListener("change", (status) => {
      if (status === "active") void refresh();
    });
    const poll = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 60_000);
    return () => {
      mounted.current = false;
      generation.current++;
      unsubscribe();
      auth.subscription.unsubscribe();
      app.remove();
      clearInterval(poll);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !state) return;
    const delay = nextShopBoundaryDelay(state, performance.now() - state.receivedAt);
    if (delay === null) return;
    const timer = setTimeout(() => {
      project(); // Expire immediately even if refresh fails/offline.
      void refresh();
    }, Math.min(delay + 1, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [enabled, state, project, refresh]);
  return { state, error, loading, refresh };
}
