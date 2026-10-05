import type { DominoOneVsOneAdapter } from "../adapters/domino-one-vs-one-adapter";
import { useAuthState } from "@/lib/auth-state";
import { RealtimeReconnectPolicy } from "@/lib/multiplayer/core/realtime-reconnect";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

export function useDominoOneVsOneConnectionController(args: {
  roomId?: string;
  adapter: DominoOneVsOneAdapter | null;
  loading: boolean;
  status: unknown;
  roundWinnerPlayerId: string | null;
  winningTeamId: string | null;
  rawState: any;
  currentUserId: string | null;
  players: any[];
  privateHandCount: number;
  applySnapshot: (snapshot: any) => boolean;
  setLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
  setCurrentUserId: (value: string | null) => void;
  setPlayers: (rows: any[]) => void;
  setProfiles: (profiles: Map<string, any>) => void;
  enabled?: boolean;
}) {
  const { userId } = useAuthState();
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const startInFlightRef = useRef(false);
  const pollInFlightRef = useRef(false);
  // eslint-disable-next-line react-hooks/purity
  const lastActivityRef = useRef(Date.now());
  // eslint-disable-next-line react-hooks/purity
  const lastRosterActivityRef = useRef(Date.now());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectPolicyRef = useRef(new RealtimeReconnectPolicy());

  const refreshSnapshot = useCallback(async () => {
    if (!args.adapter) throw new Error("No 1v1 room id");
    const snapshot = await args.adapter.getSnapshot();
    args.applySnapshot(snapshot);
    return snapshot;
  }, [args.adapter, args.applySnapshot]);

  const reconnect = useCallback(async () => {
    if (!args.adapter) throw new Error("No 1v1 room id");
    const snapshot = await args.adapter.reconnect();
    args.applySnapshot(snapshot);
    return snapshot;
  }, [args.adapter, args.applySnapshot]);

  const refreshPlayers = useCallback(async (includeProfiles = true) => {
    if (!args.adapter) throw new Error("No 1v1 room id");
    const { rows, profiles } = await args.adapter.getRoster(includeProfiles);
    args.setPlayers(rows);
    lastRosterActivityRef.current = Date.now();
    if (profiles !== null) {
      args.setProfiles(new Map(profiles.map((profile: any) => [profile.id, profile])));
    }
    return rows;
  }, [args.adapter, args.setPlayers, args.setProfiles]);

  useEffect(() => {
    const isEnabled = args.enabled ?? Boolean(args.roomId);
    if (!isEnabled) {
      args.setError(null);
      args.setLoading(false);
      return;
    }

    if (!args.roomId || !args.adapter) {
      args.setError("No 1v1 room id");
      args.setLoading(false);
      return;
    }
    if (!userId) return;

    let mounted = true;
    const markActivity = () => { lastActivityRef.current = Date.now(); };

    const loadRoom = async () => {
      const snapshot = await refreshSnapshot();
      if (!mounted) return;
      const hasStarted =
        snapshot?.state?.status === "started" || Array.isArray(snapshot?.state?.handCounts);
      if (
        !hasStarted &&
        (snapshot?.status === "waiting" || snapshot?.status === "active") &&
        !startInFlightRef.current
      ) {
        startInFlightRef.current = true;
        try {
          const started = await args.adapter!.startGame();
          if (mounted) args.applySnapshot(started);
        } finally {
          startInFlightRef.current = false;
        }
      }
    };

    let subscribe = () => {};
    const handleStatus = (channel: string, status: string, error?: unknown) => {
      if (!mounted) return;
      const delay = reconnectPolicyRef.current.observe(status);
      if (status === "SUBSCRIBED") {
        markActivity();
        args.setError(null);
        void loadRoom();
        void refreshPlayers();
      } else if (delay !== null) {
        console.warn(`1v1 Realtime ${channel} status: ${status}`, error);
        if (!reconnectTimerRef.current && mounted) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (mounted) subscribe();
          }, delay);
        }
      }
    };

    subscribe = () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = args.adapter!.subscribe({
onRoomInvalidated: () => {
  if (!mounted) return;
  markActivity();

  void refreshSnapshot().catch((error) => {
    console.warn("1v1 snapshot refresh after room realtime update failed", error);
  });
},
        onRosterInvalidated: () => {
          if (!mounted) return;
          markActivity();
          lastRosterActivityRef.current = Date.now();
          void refreshPlayers();
        },
        onTakeoverInvalidated: () => {
          if (!mounted) return;
          markActivity();
          void refreshPlayers();
        },
        onStatus: handleStatus,
      });
    };

const boot = async () => {
  try {
    args.setLoading(true);
    args.setError(null);

    if (!mounted) return;

    args.setCurrentUserId(userId);

    await Promise.all([loadRoom(), refreshPlayers()]);
    if (!mounted) return;

    subscribe();
    args.setLoading(false);
  } catch (error: any) {
    if (!mounted) return;

    args.setError(error?.message ?? String(error));
    args.setLoading(false);
  }
};

    void boot();
    return () => {
      mounted = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      reconnectPolicyRef.current.reset();
    };
  }, [
    args.roomId,
    args.enabled,
    args.adapter,
    userId,
    args.applySnapshot,
    args.setLoading,
    args.setError,
    args.setCurrentUserId,
    refreshSnapshot,
    refreshPlayers,
  ]);

  useEffect(() => {
    if (!args.roomId) return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      void Promise.all([
        reconnect(),
        refreshPlayers(false),
      ])
        .then(() => { lastActivityRef.current = Date.now(); })
        .catch((error) => console.warn("1v1 AppState reconcile failed", error));
    });
    return () => subscription.remove();
  }, [args.roomId, reconnect, refreshPlayers]);

  useEffect(() => {
    if (
      !args.roomId || args.loading || args.roundWinnerPlayerId ||
      args.winningTeamId || args.status === "finished"
    ) return;

    const interval = setInterval(() => {
      if (pollInFlightRef.current) return;
      const now = Date.now();
      const snapshotIsStale = now - lastActivityRef.current >= 12_000;
      const rosterIsStale = now - lastRosterActivityRef.current >= 12_000;
      if (!snapshotIsStale && !rosterIsStale) return;
      pollInFlightRef.current = true;
      const fallback = snapshotIsStale
        ? Promise.all([refreshSnapshot(), refreshPlayers(false)])
        : refreshPlayers(false);
      void fallback
        .then(() => {
          if (snapshotIsStale) lastActivityRef.current = Date.now();
        })
        .catch((error) => console.warn("1v1 snapshot fallback watchdog failed", error))
        .finally(() => { pollInFlightRef.current = false; });
    }, 3_000);

    return () => {
      clearInterval(interval);
      pollInFlightRef.current = false;
    };
  }, [
    args.roomId,
    args.loading,
    args.status,
    args.roundWinnerPlayerId,
    args.winningTeamId,
    refreshSnapshot,
    refreshPlayers,
  ]);

  useEffect(() => {
    if (!args.roomId || args.loading || !args.adapter || !args.rawState) return;
    if (
      args.rawState.roundWinnerPlayerId || args.rawState.winningTeamId ||
      args.rawState.status === "finished" || args.privateHandCount > 0
    ) return;
    const playerIndex = args.players.find(
      (row) => row.user_id === args.currentUserId,
    )?.player_index;
    const expectedHandCount = Number(args.rawState.handCounts?.[playerIndex] ?? 0);
    if (expectedHandCount <= 0) return;

    const retry = setTimeout(() => {
      void args.adapter!.getSnapshot()
        .then(args.applySnapshot)
        .catch((error) => console.warn("1v1 private hand snapshot retry failed", error));
    }, 350);
    return () => clearTimeout(retry);
  }, [
    args.roomId,
    args.loading,
    args.adapter,
    args.rawState,
    args.privateHandCount,
    args.players,
    args.currentUserId,
    args.applySnapshot,
  ]);
  return { refreshSnapshot, refreshPlayers };
}

