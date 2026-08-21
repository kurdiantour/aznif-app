import type { DominoOneVsOneAdapter } from "../adapters/domino-one-vs-one-adapter";
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
  getPrivateHand: () => unknown[];
  setLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
  setCurrentUserId: (value: string | null) => void;
  setPlayers: (rows: any[]) => void;
  setProfiles: (profiles: Map<string, any>) => void;
}) {
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const startInFlightRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const takeoverRosterInFlightRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
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
    if (profiles !== null) {
      args.setProfiles(new Map(profiles.map((profile: any) => [profile.id, profile])));
    }
    return rows;
  }, [args.adapter, args.setPlayers, args.setProfiles]);

  useEffect(() => {
    if (!args.roomId || !args.adapter) {
      args.setError("No 1v1 room id");
      args.setLoading(false);
      return;
    }

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
        onRoomInvalidated: (snapshot) => {
          if (!mounted || !snapshot) return;
          markActivity();
          args.applySnapshot({
            ...(snapshot as any),
            state: { ...((snapshot as any).state ?? {}), myHand: args.getPrivateHand() },
          });
          void refreshSnapshot().catch((error) => {
            console.warn("1v1 private hand refresh after room realtime update failed", error);
          });
        },
        onRosterInvalidated: () => {
          if (!mounted) return;
          markActivity();
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
        const userId = await args.adapter!.getCurrentUserId();
        if (!mounted) return;
        args.setCurrentUserId(userId);
        await Promise.all([loadRoom(), refreshPlayers()]);
        subscribe();
        if (mounted) args.setLoading(false);
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
    args.adapter,
    args.applySnapshot,
    args.getPrivateHand,
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
      void Promise.all([reconnect(), refreshPlayers(false)])
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
      if (pollInFlightRef.current || Date.now() - lastActivityRef.current < 12_000) return;
      pollInFlightRef.current = true;
      void Promise.all([refreshSnapshot(), refreshPlayers(false)])
        .then(() => { lastActivityRef.current = Date.now(); })
        .catch((error) => console.warn("1v1 snapshot fallback watchdog failed", error))
        .finally(() => { pollInFlightRef.current = false; });
    }, 5_000);

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
    if (!args.roomId || args.loading) return;

    const reconcileTakeoverRoster = async () => {
      if (takeoverRosterInFlightRef.current) return;
      takeoverRosterInFlightRef.current = true;
      try {
        await refreshPlayers(false);
      } catch (error) {
        console.warn("1v1 takeover roster reconcile failed", error);
      } finally {
        takeoverRosterInFlightRef.current = false;
      }
    };

    void reconcileTakeoverRoster();
    const interval = setInterval(() => void reconcileTakeoverRoster(), 2_000);
    return () => {
      clearInterval(interval);
      takeoverRosterInFlightRef.current = false;
    };
  }, [args.roomId, args.loading, refreshPlayers]);
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
