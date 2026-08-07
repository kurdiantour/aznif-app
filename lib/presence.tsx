import { usePathname } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";

import { useProfile } from "./profile";
import { supabase } from "./supabase";

export type PresenceStatus =
  | "online_available"
  | "matchmaking"
  | "in_game"
  | "away";

type PresenceContextValue = {
  statuses: Record<string, PresenceStatus>;
  refreshPresence: (userIds: string[]) => Promise<void>;
};

const PresenceContext = createContext<PresenceContextValue | null>(null);
const ONLINE_WINDOW_MS = 35_000;

function routeStatus(pathname: string): PresenceStatus {
  if (
    pathname === "/domino/game" ||
    pathname.startsWith("/domino/game/")
  ) {
    return "in_game";
  }

  if (
    pathname === "/domino/matchmaking" ||
    pathname.startsWith("/domino/matchmaking/")
  ) {
    return "matchmaking";
  }

  return "online_available";
}

export function PresenceProvider({ children }: PropsWithChildren) {
  const { profile } = useProfile();
  const pathname = usePathname();
  const [statuses, setStatuses] = useState<Record<string, PresenceStatus>>({});

  const publishPresence = useCallback(async (status: PresenceStatus) => {
    const { error } = await supabase.rpc("update_my_presence", {
      p_status: status,
    });
    if (error) console.warn("Unable to update presence", error);
  }, []);

  const refreshPresence = useCallback(async (userIds: string[]) => {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    if (ids.length === 0) return;

    const { data, error } = await supabase
      .from("user_presence")
      .select("user_id, status, last_seen_at")
      .in("user_id", ids);
    if (error) throw error;

    const now = Date.now();
    const next: Record<string, PresenceStatus> = {};
    for (const row of data ?? []) {
      if (now - new Date(row.last_seen_at).getTime() <= ONLINE_WINDOW_MS) {
        next[row.user_id] = row.status as PresenceStatus;
      }
    }
    setStatuses((current) => {
      const copy = { ...current };
      ids.forEach((id) => delete copy[id]);
      return { ...copy, ...next };
    });
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    let appState = AppState.currentState;
    const currentStatus = () =>
      appState === "active" ? routeStatus(pathname) : "away";

    void publishPresence(currentStatus());
    const heartbeat = setInterval(
      () => void publishPresence(currentStatus()),
      15_000,
    );
    const subscription = AppState.addEventListener("change", (next) => {
      appState = next;
      void publishPresence(currentStatus());
    });
    return () => {
      clearInterval(heartbeat);
      subscription.remove();
    };
  }, [pathname, profile?.id, publishPresence]);

  const value = useMemo(
    () => ({ statuses, refreshPresence }),
    [refreshPresence, statuses],
  );
  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  const context = useContext(PresenceContext);
  if (!context) throw new Error("usePresence must be used within PresenceProvider");
  return context;
}
