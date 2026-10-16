import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { supabase } from "@/lib/supabase";
import type { GameState, Move } from "./engine";

export type DamaOnlinePlayer = {
  id: string;
  userId: string | null;
  botProfileId?: string | null;
  isBot?: boolean;
  playerIndex: number;
  pieceColor: "cream" | "black";
  connected: boolean;
  botTakeover: boolean;
  consecutiveTimeoutStrikes: number;
  lastSeenAt: string;
  username: string;
  avatarId?: string;
  avatarUrl?: string;
};

export type DamaOnlineSnapshot = {
  id: string;
  status: "waiting" | "active" | "finished" | "cancelled";
  version: number;
  state: GameState | null;
  current_turn_user_id: string | null;
  winner_user_id: string | null;
  finish_reason: string | null;
  countdown_ends_at?: string | null;
  matchmaking_deadline_at?: string | null;
  matchmaking_started_at?: string | null;
  settlement?: { type?: string; currency?: "coin"; entryFeePerPlayer?: number; payout?: number; netCoinDelta?: number; pointDelta?: number; gemDelta?: number; winnerPointDelta?: number; winnerGemDelta?: number; loserPointDelta?: number; loserGemDelta?: number; takeoverPointDelta?: number; takeoverGemDelta?: number; manualLeaverUserId?: string; manualLeavePointDelta?: number; reason?: string } | null;
  players: DamaOnlinePlayer[];
};

function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<GameState>;
  return Array.isArray(state.pieces) && (state.turn === "cream" || state.turn === "black");
}

function isCompleteSnapshot(value: DamaOnlineSnapshot): boolean {
  return Array.isArray(value.players) && Number.isFinite(Number(value.version)) &&
    (value.state === null || isGameState(value.state));
}

export function useDamaMultiplayer(enabled: boolean, initialMatchId?: string) {
  const [matchId, setMatchId] = useState(initialMatchId ?? "");
  const [matchmakingStatus, setMatchmakingStatus] = useState<"idle" | "searching" | "matched" | "error">(enabled ? "searching" : "idle");
  const [snapshot, setSnapshot] = useState<DamaOnlineSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const versionRef = useRef(-1);
  const snapshotRef = useRef<DamaOnlineSnapshot | null>(null);
  const matchIdRef = useRef(initialMatchId ?? "");
  const refreshInFlightRef = useRef<Promise<DamaOnlineSnapshot | null> | null>(null);
  const refreshRef = useRef<() => Promise<DamaOnlineSnapshot | null>>(async () => null);

  const applySnapshot = useCallback((value: DamaOnlineSnapshot | null): boolean => {
    if (!value) return false;
    if (value.id) {
      matchIdRef.current = value.id;
      setMatchId(value.id);
    }
    // Realtime and RPC responses can overlap a server-side state transition.
    // Do not replace a known-good board with a partial payload.
    if (!isCompleteSnapshot(value)) {
      const canRefresh = !refreshInFlightRef.current && !!matchIdRef.current;
      setError(canRefresh ? "Incomplete Dama match data; refreshing the board" : "Incomplete Dama match data");
      if (canRefresh) {
        void refreshRef.current().catch((reason) => {
          setError(reason instanceof Error ? reason.message : String(reason));
        });
      }
      return false;
    }
    const version = Number(value.version);
    if (version < versionRef.current) return true;
    versionRef.current = version;
    setError(null);
    const previous = snapshotRef.current;
    let next = value;
    // Realtime notifications and the five-second poll can overlap. If a
    // response is assembled while a seat update is in flight, the server may
    // briefly return fewer players than the last complete snapshot. Keep the
    // known seats for live matches so the opponent does not flash as the
    // generic "Opponent" with the default avatar.
    if (previous?.id === value.id && value.status === "active" && previous.status === "active") {
      const incomingIds = new Set(value.players.map((player) => player.id));
      const missingKnownPlayers = previous.players.filter((player) => !incomingIds.has(player.id));
      if (missingKnownPlayers.length) {
        next = {
          ...value,
          players: [...value.players, ...missingKnownPlayers].sort((a, b) => a.playerIndex - b.playerIndex),
        };
      }
    }
    if (previous?.id === value.id && version === Number(previous.version) &&
        value.status === previous.status && value.current_turn_user_id === previous.current_turn_user_id &&
        value.state === previous.state && value.settlement === previous.settlement &&
        value.players.length === previous.players.length &&
        value.players.every((player, index) => player.id === previous.players[index]?.id &&
          player.connected === previous.players[index]?.connected &&
          player.botTakeover === previous.players[index]?.botTakeover)) {
      return true;
    }
    snapshotRef.current = next;
    setSnapshot(next);
    setMatchmakingStatus(value.status === "waiting" ? "searching" : "matched");
    return true;
  }, []);

  const refresh = useCallback(async () => {
    const id = matchIdRef.current || matchId;
    if (!id) return null;
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const pending = (async () => {
      const { data, error: rpcError } = await supabase.rpc("get_dama_match_snapshot", { p_match_id: id });
      if (rpcError) throw rpcError;
      applySnapshot(data as DamaOnlineSnapshot);
      return snapshotRef.current ?? (data as DamaOnlineSnapshot);
    })();
    refreshInFlightRef.current = pending;
    try {
      return await pending;
    } finally {
      if (refreshInFlightRef.current === pending) refreshInFlightRef.current = null;
    }
  }, [applySnapshot, matchId]);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled || matchId) return;
    let live = true;
    setMatchmakingStatus("searching");
    void (async () => {
      try {
        const { data, error: rpcError } = await supabase.functions.invoke("dama_match", { body: {} });
        if (!live) return;
        if (rpcError) {
          let message = rpcError.message;
          try { message = (await (rpcError as any).context?.json())?.error ?? message; } catch { /* retain transport error */ }
          throw new Error(message);
        }
        const nextId = String(data?.match_id ?? "");
        if (!nextId) throw new Error("Matchmaking did not return a match id");
        matchIdRef.current = nextId;
        setMatchId(nextId);
        const { data: initial, error: snapshotError } = await supabase.rpc("get_dama_match_snapshot", { p_match_id: nextId });
        if (snapshotError) throw snapshotError;
        applySnapshot(initial as DamaOnlineSnapshot);
        setMatchmakingStatus(data?.status === "matched" ? "matched" : "searching");
      } catch (reason) {
        if (!live) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setMatchmakingStatus("error");
      }
    })();
    return () => { live = false; };
  }, [applySnapshot, enabled, matchId]);

  useEffect(() => {
    // A terminal match no longer needs polling, heartbeat, or a realtime subscription.
    if (!enabled || !matchId || snapshot?.status === "finished" || snapshot?.status === "cancelled") return;
    let active = true;
    const reload = () => { void refresh().catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }); };
    reload();
    const channel = supabase.channel(`dama-match:${matchId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "dama_matches", filter: `id=eq.${matchId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "dama_match_players", filter: `match_id=eq.${matchId}` }, reload)
      .subscribe((status) => { if (status === "SUBSCRIBED") reload(); });
    const poll = setInterval(() => {
      if (AppState.currentState === "active") reload();
    }, 5_000);
    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        void supabase.rpc("dama_heartbeat", { p_match_id: matchId }).then(({ error: heartbeatError }) => {
          if (heartbeatError && active) setError(heartbeatError.message);
        });
      }
    }, 30_000);
    void supabase.rpc("dama_heartbeat", { p_match_id: matchId });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void supabase.rpc("dama_heartbeat", { p_match_id: matchId });
        reload();
      }
    });
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(interval);
      appState.remove();
      void supabase.removeChannel(channel);
    };
  }, [enabled, matchId, refresh, snapshot?.status]);

  const sendMove = useCallback(async (move: Move) => {
    if (!matchId || !snapshot) throw new Error("Dama match is not ready");
    setBusy(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("dama_action", {
        body: { action: "move", match_id: matchId, expected_version: snapshot.version, move },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      const expectedVersion = Number(snapshot.version);
      const requireNewerSnapshot = async () => {
        await refresh();
        const latest = snapshotRef.current;
        if (!latest || latest.id !== matchId || !isCompleteSnapshot(latest) || Number(latest.version) <= expectedVersion) {
          throw new Error("Incomplete Dama match data after refresh");
        }
        return latest;
      };
      const current = snapshotRef.current;
      if (!current || current.id !== matchId || !data?.match || typeof data.match !== "object") {
        return await requireNewerSnapshot();
      }
      // commit_dama_action returns the authoritative match row fields, while
      // the private roster is intentionally only included by the snapshot RPC.
      // Keep the last validated player profiles when applying this move result.
      const committedSnapshot = { ...current, ...data.match, players: current.players } as DamaOnlineSnapshot;
      if (!applySnapshot(committedSnapshot)) return await requireNewerSnapshot();
      // Pull connected/botTakeover from the private roster without blocking the move.
      void refresh().catch(() => undefined);
      return committedSnapshot;
    } finally { setBusy(false); }
  }, [applySnapshot, matchId, refresh, snapshot]);

  const cancelOrLeave = useCallback(async () => {
    if (!matchId) return;
    setBusy(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("dama_match", { body: { action: "leave", match_id: matchId } });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      // Leaving a waiting match removes the caller from its active membership. A
      // subsequent snapshot RPC is then correctly rejected by the membership
      // policy, which used to prevent the screen from navigating back to Lobby.
    } finally { setBusy(false); }
  }, [matchId]);

  const players = useMemo(() => snapshot?.players ?? [], [snapshot]);
  return { matchId, matchmakingStatus, snapshot, players, error, busy, refresh, sendMove, cancelOrLeave };
}