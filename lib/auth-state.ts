import type { Session } from "@supabase/supabase-js";
import { useSyncExternalStore } from "react";

// Written only by ProfileProvider, including synchronously inside auth events.
let state = { authReady: false, session: null as Session | null, userId: null as string | null, generation: 0, active: false };
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
export const getAuthState = () => state;
export function publishAuthState(session: Session | null, authReady: boolean, active = state.active) {
  if (session === state.session && authReady === state.authReady && active === state.active) return;
  // Restoring an equivalent session object or changing app readiness is not a new session.
  const previous = state.session;
  const sessionChanged = !!previous !== !!session ||
    previous?.user.id !== session?.user.id ||
    previous?.access_token !== session?.access_token ||
    previous?.refresh_token !== session?.refresh_token ||
    previous?.expires_at !== session?.expires_at;
  state = { session, authReady, active, userId: session?.user.id ?? null, generation: state.generation + (sessionChanged ? 1 : 0) };
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
  if (active && authReady && session?.expires_at) {
    const delay = session.expires_at * 1000 - Date.now();
    if (delay > 0) expiryTimer = setTimeout(() => publishAuthState(state.session, false), Math.min(delay, 2147483647));
  }
  listeners.forEach((listener) => listener());
}
export function subscribeAuthState(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useAuthState() {
  return useSyncExternalStore(subscribeAuthState, getAuthState, getAuthState);
}
export function hasReadySession(snapshot = state) {
  return snapshot.authReady && snapshot.active && !!snapshot.session?.access_token &&
    (!snapshot.session.expires_at || snapshot.session.expires_at * 1000 > Date.now());
}
export function requireReadySession() {
  if (!hasReadySession()) throw new Error("Sign in is required before loading personal data.");
  return state;
}
