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

export function useDamaMultiplayer(enabled: boolean, initialMatchId?: string) {
  const [matchId, setMatchId] = useState(initialMatchId ?? "");
  const [matchmakingStatus, setMatchmakingStatus] = useState<"idle" | "searching" | "matched" | "error">(enabled ? "searching" : "idle");
  const [snapshot, setSnapshot] = useState<DamaOnlineSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const versionRef = useRef(-1);
  const snapshotRef = useRef<DamaOnlineSnapshot | null>(null);

  const applySnapshot = useCallback((value: DamaOnlineSnapshot | null) => {
    if (!value) return;
    // Realtime and RPC responses can overlap a server-side state transition.
    // Do not replace a known-good board with a partial payload.
    if (!Array.isArray(value.players) || (value.state !== null && !isGameState(value.state))) {
      setError("Incomplete Dama match data; refreshing the board");
      return;
    }
    if (Number(value.version) < versionRef.current) return;
    versionRef.current = Number(value.version);
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
    if (previous?.id === value.id && Number(value.version) === Number(previous.version) &&
        value.status === previous.status && value.current_turn_user_id === previous.current_turn_user_id &&
        value.state === previous.state && value.settlement === previous.settlement &&
        value.players.length === previous.players.length &&
        value.players.every((player, index) => player.id === previous.players[index]?.id &&
          player.connected === previous.players[index]?.connected &&
          player.botTakeover === previous.players[index]?.botTakeover)) {
      return;
    }
    snapshotRef.current = next;
    setSnapshot(next);
    setMatchId(value.id);
    setMatchmakingStatus(value.status === "waiting" ? "searching" : "matched");
  }, []);

  const refresh = useCallback(async () => {
    if (!matchId) return null;
    const { data, error: rpcError } = await supabase.rpc("get_dama_match_snapshot", { p_match_id: matchId });
    if (rpcError) throw rpcError;
    applySnapshot(data as DamaOnlineSnapshot);
    return data as DamaOnlineSnapshot;
  }, [applySnapshot, matchId]);

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
        const { data: initial, error: snapshotError } = await supabase.rpc("get_dama_match_snapshot", { p_match_id: nextId });
        if (snapshotError) throw snapshotError;
        applySnapshot(initial as DamaOnlineSnapshot);
        setMatchId(nextId);
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
    if (!enabled || !matchId) return;
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
  }, [enabled, matchId, refresh]);

  const sendMove = useCallback(async (move: Move) => {
    if (!matchId || !snapshot) throw new Error("Dama match is not ready");
    setBusy(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("dama_action", {
        body: { action: "move", match_id: matchId, expected_version: snapshot.version, move },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      const current = snapshotRef.current;
      if (!current || current.id !== matchId || !data?.match || typeof data.match !== "object") {
        await refresh();
        return data.match as DamaOnlineSnapshot;
      }
      // commit_dama_action returns the authoritative match row fields, while
      // the private roster is intentionally only included by the snapshot RPC.
      // Keep the last validated player profiles when applying this move result.
      const committedSnapshot = { ...current, ...data.match, players: current.players } as DamaOnlineSnapshot;
      applySnapshot(committedSnapshot);
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
