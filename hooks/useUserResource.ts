import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthState, hasReadySession, useAuthState, subscribeAuthState } from "@/lib/auth-state";

export function useUserResource<T>(load: () => Promise<T>, enabled = true, pollMs?: number, initial?: () => T | null) {
  const auth = useAuthState();
  const allowed = enabled && hasReadySession(auth);
  const [value, setValue] = useState<{ generation: number; data: T } | null>(() => {
    const data = allowed ? initial?.() : null;
    return data ? { generation: auth.generation, data } : null;
  });
  const [error, setError] = useState<{ generation: number; cause: Error } | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const inFlight = useRef<{ generation: number; promise: Promise<T | null> } | null>(null);
  const current = useCallback(() => mounted.current && enabled && getAuthState().generation === auth.generation, [enabled, auth.generation]);
  const refresh = useCallback((): Promise<T | null> => {
    if (!current() || !hasReadySession()) return Promise.resolve(null);
    if (inFlight.current?.generation === auth.generation) return inFlight.current.promise;
    const request = ++sequence.current;
    setLoading(auth.generation);
    // Defer load so the in-flight slot exists even if load throws synchronously.
    const promise = Promise.resolve().then(async () => {
      try {
        if (!current() || !hasReadySession() || request !== sequence.current) return null;
        const data = await load();
        if (!current() || request !== sequence.current) return null;
        setValue({ generation: auth.generation, data });
        setError(null);
        return data;
      } catch (cause) {
        if (current() && request === sequence.current) setError({ generation: auth.generation, cause: cause instanceof Error ? cause : new Error(String((cause as { message?: string })?.message ?? cause)) });
        return null;
      } finally {
        if (current() && request === sequence.current) setLoading(null);
        if (inFlight.current?.promise === promise) inFlight.current = null;
      }
    });
    inFlight.current = { generation: auth.generation, promise };
    return promise;
  }, [auth.generation, current, load]);
  const accept = useCallback((data: T) => {
    if (!current()) return;
    sequence.current++;
    inFlight.current = null;
    setValue({ generation: auth.generation, data });
    setLoading(null);
    setError(null);
  }, [current, auth.generation]);
  useEffect(() => {
    mounted.current = true;
    if (allowed) void Promise.resolve().then(refresh);
    const timer = allowed && pollMs ? setInterval(() => { void refresh(); }, pollMs) : null;
    const unsubscribe = subscribeAuthState(() => {
      if (getAuthState().generation !== auth.generation || !hasReadySession()) {
        sequence.current++;
        inFlight.current = null;
        if (timer !== null) clearInterval(timer);
      }
    });
    return () => {
      unsubscribe();
      mounted.current = false;
      // Invalidate reads even if this effect is restarted in the same auth generation.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
      inFlight.current = null;
      if (timer !== null) clearInterval(timer);
    };
  }, [allowed, refresh, pollMs, initial, auth.generation]);
  return { data: allowed && value?.generation === auth.generation ? value.data : null, error: allowed && error?.generation === auth.generation ? error.cause : null, loading: allowed && loading === auth.generation, refresh, accept, current, generation: auth.generation, allowed };
}
