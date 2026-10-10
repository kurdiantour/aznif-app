import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { supabase } from "@/lib/supabase";
import type { GameState, Move } from "./engine";

export type DamaOnlinePlayer = {
  id: string;
  userId: string;
  playerIndex: number;
  pieceColor: "cream" | "black";
  connected: boolean;
  botTakeover: boolean;
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
  players: DamaOnlinePlayer[];
};

export function useDamaMultiplayer(enabled: boolean, initialMatchId?: string) {
  const [matchId, setMatchId] = useState(initialMatchId ?? "");
  const [matchmakingStatus, setMatchmakingStatus] = useState<"idle" | "searching" | "matched" | "error">(enabled ? "searching" : "idle");
  const [snapshot, setSnapshot] = useState<DamaOnlineSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const versionRef = useRef(-1);

  const applySnapshot = useCallback((value: DamaOnlineSnapshot | null) => {
    if (!value) return;
    if (Number(value.version) < versionRef.current) return;
    versionRef.current = Number(value.version);
    setSnapshot(value);
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
        const { data, error: rpcError } = await supabase.rpc("find_dama_match");
        if (!live) return;
        if (rpcError) throw rpcError;
        const nextId = String(data?.match_id ?? "");
        if (!nextId) throw new Error("Matchmaking did not return a match id");
        setMatchId(nextId);
        setMatchmakingStatus(data?.status === "matched" ? "matched" : "searching");
      } catch (reason) {
        if (!live) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setMatchmakingStatus("error");
      }
    })();
    return () => { live = false; };
  }, [enabled, matchId]);

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
      applySnapshot(data.match as DamaOnlineSnapshot);
      return data.match as DamaOnlineSnapshot;
    } finally { setBusy(false); }
  }, [applySnapshot, matchId, snapshot]);

  const submitTimeout = useCallback(async () => {
    if (!matchId || !snapshot) return;
    const { data, error: invokeError } = await supabase.functions.invoke("dama_action", {
      body: { action: "timeout", match_id: matchId, expected_version: snapshot.version },
    });
    if (invokeError) throw invokeError;
    if (data?.match) applySnapshot(data.match as DamaOnlineSnapshot);
  }, [applySnapshot, matchId, snapshot]);

  const submitBot = useCallback(async () => {
    if (!matchId || !snapshot) return;
    const { data, error: invokeError } = await supabase.functions.invoke("dama_action", {
      body: { action: "bot", match_id: matchId, expected_version: snapshot.version },
    });
    if (invokeError) throw invokeError;
    if (data?.match) applySnapshot(data.match as DamaOnlineSnapshot);
  }, [applySnapshot, matchId, snapshot]);

  const cancelOrLeave = useCallback(async () => {
    if (!matchId) return;
    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc("dama_leave_match", { p_match_id: matchId });
      if (rpcError) throw rpcError;
      await refresh();
    } finally { setBusy(false); }
  }, [matchId, refresh]);

  const restoreControl = useCallback(async () => {
    if (!matchId) return;
    const { error: rpcError } = await supabase.rpc("dama_restore_control", { p_match_id: matchId });
    if (rpcError) throw rpcError;
    await refresh();
  }, [matchId, refresh]);

  const claimBotTakeover = useCallback(async () => {
    if (!matchId) return false;
    const { data, error: rpcError } = await supabase.rpc("dama_claim_bot_takeover", { p_match_id: matchId });
    if (rpcError) throw rpcError;
    if (data) await refresh();
    return Boolean(data);
  }, [matchId, refresh]);

  const players = useMemo(() => snapshot?.players ?? [], [snapshot]);
  return { matchId, matchmakingStatus, snapshot, players, error, busy, refresh, sendMove, submitTimeout, submitBot, cancelOrLeave, restoreControl, claimBotTakeover };
}
