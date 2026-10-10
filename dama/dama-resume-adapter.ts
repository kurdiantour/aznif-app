import { supabase } from "@/lib/supabase";
import type { MultiplayerResumeAdapter, ResumableMatch } from "@/lib/multiplayer/resume/types";

async function loadActiveDamaRoom(roomId: string, userId: string) {
  const { data: player, error: playerError } = await supabase
    .from("dama_players")
    .select("room_id, bot_takeover")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();

  if (playerError || !player || player.bot_takeover) return null;

  const { data: room, error: roomError } = await supabase
    .from("dama_rooms")
    .select("id, status, entry_fee")
    .eq("id", roomId)
    .maybeSingle();

  if (roomError || !room || room.status !== "active") return null;

  return room;
}

function toDamaMatch(room: NonNullable<Awaited<ReturnType<typeof loadActiveDamaRoom>>>): ResumableMatch {
  return {
    game: "dama",
    matchId: room.id,
    route: "/dama/game",
    params: { roomId: room.id, entryFee: String(room.entry_fee ?? 500) },
  };
}

export const damaResumeAdapter: MultiplayerResumeAdapter = {
  game: "dama",
  isGameRoute: (pathname) => pathname === "/dama/game",

  async findActive(userId: string) {
    const { data: players, error } = await supabase
      .from("dama_players")
      .select("room_id, bot_takeover, created_at")
      .eq("user_id", userId)
      .eq("bot_takeover", false)
      .order("created_at", { ascending: false })
      .limit(3);

    if (error || !players) return null;

    for (const p of players) {
      const room = await loadActiveDamaRoom(p.room_id, userId);
      if (room) return toDamaMatch(room);
    }

    return null;
  },

  async validate(match: ResumableMatch, userId: string) {
    return Boolean(await loadActiveDamaRoom(match.matchId, userId));
  },

  watch(match: ResumableMatch, onInvalidated: () => void) {
    const channel = supabase
      .channel(`resume:dama:room:${match.matchId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "dama_rooms",
          filter: `id=eq.${match.matchId}`,
        },
        (payload: any) => {
          if (payload.new?.status !== "active") {
            onInvalidated();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  },

  async returnToMatch(match: ResumableMatch, userId: string) {
    const room = await loadActiveDamaRoom(match.matchId, userId);
    if (!room) return false;

    return true;
  },

  async reject(match: ResumableMatch, _userId?: string) {
    // Player manually declined to return to Dama room; forfeit the match gracefully
    try {
      await supabase.rpc("dama_leave_match", { p_room_id: match.matchId });
    } catch {
      // Ignored
    }
  },
};
