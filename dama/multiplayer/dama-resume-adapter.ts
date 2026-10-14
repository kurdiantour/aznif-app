import { supabase } from "@/lib/supabase";
import type { MultiplayerResumeAdapter, ResumableMatch } from "@/lib/multiplayer/resume/types";

async function loadMatch(matchId: string, userId: string) {
  const { data, error } = await supabase.from("dama_matches")
    .select("id,status")
    .eq("id", matchId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: seat, error: seatError } = await supabase.from("dama_match_players")
    .select("user_id,bot_takeover,left_at,manual_left")
    .eq("match_id", matchId)
    .eq("user_id", userId)
    .is("left_at", null)
    .eq("manual_left", false)
    .maybeSingle();
  if (seatError) throw seatError;
  return seat ? { match: data, seat } : null;
}

export const damaResumeAdapter: MultiplayerResumeAdapter = {
  game: "dama",
  isGameRoute: (pathname) => pathname === "/dama/game",
  async findActive(userId) {
    const { data, error } = await supabase.from("dama_match_players")
      .select("match_id,joined_at")
      .eq("user_id", userId)
      .is("left_at", null)
      .eq("manual_left", false)
      .order("joined_at", { ascending: false });
    if (error) throw error;
    for (const row of data ?? []) {
      if (await loadMatch(row.match_id, userId)) return {
        game: "dama", matchId: row.match_id, route: "/dama/game",
        params: { mode: "online", match_id: row.match_id },
      };
    }
    return null;
  },
  async validate(match, userId) { return Boolean(await loadMatch(match.matchId, userId)); },
  watch(match, onInvalidated) {
    const channel = supabase.channel(`resume:dama:${match.matchId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "dama_matches", filter: `id=eq.${match.matchId}` }, onInvalidated)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "dama_match_players", filter: `match_id=eq.${match.matchId}` }, onInvalidated)
      .subscribe((status) => { if (status === "SUBSCRIBED") onInvalidated(); });
    return () => { void supabase.removeChannel(channel); };
  },
  async returnToMatch(match, userId) {
    const loaded = await loadMatch(match.matchId, userId);
    if (!loaded) return false;
    if (loaded.seat.manual_left) return false;
    // Always call the server on resume. Besides restoring takeover, this
    // re-enqueues the authoritative lifecycle if an earlier restore committed
    // but its scheduler request failed.
    const { error } = await supabase.functions.invoke("dama_match", { body: { action: "restore", match_id: match.matchId } });
    if (error) {
      if (!(await loadMatch(match.matchId, userId))) return false;
      throw error;
    }
    return Boolean(await loadMatch(match.matchId, userId));
  },
  async reject(match) {
    const { error } = await supabase.functions.invoke("dama_match", { body: { action: "leave", match_id: match.matchId } });
    if (error) throw error;
  },
};
