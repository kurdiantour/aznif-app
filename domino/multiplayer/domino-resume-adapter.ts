import { supabase } from "@/lib/supabase";
import type { MultiplayerResumeAdapter, ResumableMatch } from "@/lib/multiplayer/resume/types";

type Mode = "1v1" | "2v2";

const tables = {
  "1v1": { players: "one_vs_one_players", rooms: "one_vs_one_rooms" },
  "2v2": { players: "two_vs_two_players", rooms: "two_vs_two_rooms" },
} as const;

async function loadRoom(mode: Mode, roomId: string, userId: string) {
  const { data: member, error: memberError } = await supabase
    .from(tables[mode].players)
    .select("room_id, abandoned, left_at")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("kind", "human")
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member || member.abandoned || member.left_at) return null;

  const { data: room, error: roomError } = await supabase
    .from(tables[mode].rooms)
    .select("id, status, state, currency, entry_fee")
    .eq("id", roomId)
    .maybeSingle();
  if (roomError) throw roomError;
  if (!room || !["active", "playing"].includes(room.status)) return null;
  if (["finished", "cancelled", "completed"].includes(String(room.state?.status ?? ""))) return null;
  if (room.state?.matchFinished === true) return null;
  return room;
}

function toMatch(mode: Mode, room: NonNullable<Awaited<ReturnType<typeof loadRoom>>>): ResumableMatch {
  return {
    game: "domino",
    matchId: room.id,
    route: "/domino/game",
    params: { room_id: room.id, mode, matchmaking_status: "matched", resume: "true", playMode: room.currency === "aznif" ? "aznif" : "fun", entryFee: String(room.entry_fee ?? 0) },
  };
}

export const dominoResumeAdapter: MultiplayerResumeAdapter = {
  game: "domino",
  isGameRoute: (pathname) => pathname === "/domino/game",
  async findActive(userId) {
    const candidates: { mode: Mode; roomId: string }[] = [];
    for (const mode of ["1v1", "2v2"] as const) {
      const { data, error } = await supabase.from(tables[mode].players)
        .select("room_id, abandoned, left_at")
        .eq("user_id", userId).eq("kind", "human")
        .is("left_at", null).order("joined_at", { ascending: false });
      if (error) throw error;
      for (const row of data ?? []) if (!row.abandoned) candidates.push({ mode, roomId: row.room_id });
    }
    for (const candidate of candidates) {
      const room = await loadRoom(candidate.mode, candidate.roomId, userId);
      if (room) return toMatch(candidate.mode, room);
    }
    return null;
  },
  async validate(match, userId) {
    const mode = match.params.mode === "2v2" ? "2v2" : "1v1";
    return Boolean(await loadRoom(mode, match.matchId, userId));
  },
  watch(match, onInvalidated) {
    const mode = match.params.mode === "2v2" ? "2v2" : "1v1";
    const room = supabase.channel(`resume:${mode}:room:${match.matchId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: tables[mode].rooms,
        filter: `id=eq.${match.matchId}`,
      }, onInvalidated)
      .subscribe((status) => { if (status === "SUBSCRIBED") onInvalidated(); });
    // 1v1 publishes moves (including takeover and manual leave), while 2v2
    // publishes player rows. Both publish room updates for terminal states.
    const rosterTable = mode === "1v1" ? "one_vs_one_moves" : tables[mode].players;
    const roster = supabase.channel(`resume:${mode}:roster:${match.matchId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: rosterTable,
        filter: `room_id=eq.${match.matchId}`,
      }, onInvalidated)
      .subscribe((status) => { if (status === "SUBSCRIBED") onInvalidated(); });
    return () => { void supabase.removeChannel(room); void supabase.removeChannel(roster); };
  },
  async returnToMatch(match, userId) {
    const mode = match.params.mode === "2v2" ? "2v2" : "1v1";
    if (!(await loadRoom(mode, match.matchId, userId))) return false;
    const { data: seat, error: seatError } = await supabase.from(tables[mode].players)
      .select("bot_takeover, connected")
      .eq("room_id", match.matchId).eq("user_id", userId).maybeSingle();
    if (seatError) throw seatError;
    if (!seat) return false;
    if (!seat.bot_takeover && seat.connected) return Boolean(await loadRoom(mode, match.matchId, userId));
    const { error } = await supabase.rpc(
      mode === "1v1" ? "restore_one_vs_one_human_control" : "restore_two_vs_two_human_control",
      { p_room_id: match.matchId },
    );
    if (error) {
      // The room can finish between validation and restoring the seat.
      if (!(await loadRoom(mode, match.matchId, userId))) return false;
      throw error;
    }
    const restoredRoom = await loadRoom(mode, match.matchId, userId);
    if (!restoredRoom) return false;
    const { data: restoredSeat, error: restoredSeatError } = await supabase.from(tables[mode].players)
      .select("bot_takeover, connected")
      .eq("room_id", match.matchId).eq("user_id", userId).maybeSingle();
    if (restoredSeatError) throw restoredSeatError;
    return Boolean(restoredSeat && !restoredSeat.bot_takeover && restoredSeat.connected);
  },
  async reject(match) {
    const mode = match.params.mode === "2v2" ? "2v2" : "1v1";
    const { error } = await supabase.rpc(mode === "1v1" ? "leave_one_vs_one_match" : "leave_two_vs_two_match", { p_room_id: match.matchId });
    if (error) throw error;
  },
};
