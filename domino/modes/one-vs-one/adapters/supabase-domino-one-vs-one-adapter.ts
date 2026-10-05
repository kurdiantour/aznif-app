import { supabase } from "@/lib/supabase";
import {
  processDominoOneVsOneBotTurn,
  submitDominoOneVsOneDraw,
  submitDominoOneVsOneMove,
  submitDominoOneVsOnePass,
} from "./domino-one-vs-one-supabase-api";
import type {
  DominoOneVsOneAdapter,
  DominoOneVsOneCommand,
  DominoOneVsOneSubscription,
  DominoOneVsOneRoster,
} from "./domino-one-vs-one-adapter";

export class SupabaseDominoOneVsOneAdapter implements DominoOneVsOneAdapter {
  constructor(private readonly roomId: string) {}

  async getSnapshot() {
    const { data, error } = await supabase.rpc("get_one_vs_one_snapshot", {
      p_room_id: this.roomId,
    });
    if (error) throw error;
    return data;
  }

  async getRoster(includeProfiles = true): Promise<DominoOneVsOneRoster> {
    const { data, error } = await supabase
      .from("one_vs_one_players")
      .select(
        "id, user_id, player_index, seat, team_id, kind, connected, bot_takeover, abandoned",
      )
      .eq("room_id", this.roomId)
      .order("player_index", { ascending: true });

    if (error) throw error;

    const rows = data ?? [];

    if (!includeProfiles) {
      return { rows, profiles: null };
    }

    const userIds = rows
      .map((row: any) => row.user_id)
      .filter(Boolean);

    if (!userIds.length) {
      return { rows, profiles: [] };
    }

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, username, avatar_id, avatar_url, points")
      .in("id", userIds);

    if (profilesError) throw profilesError;

    return {
      rows,
      profiles: profiles ?? [],
    };
  }

  async prepareLaunch() {
    const { data: room, error } = await supabase
      .from("one_vs_one_rooms")
      .select("status, state")
      .eq("id", this.roomId)
      .maybeSingle();

    if (error) throw error;

    const hasStarted =
      room?.state?.status === "started" ||
      Array.isArray(room?.state?.handCounts);

    return hasStarted ? this.getSnapshot() : this.startGame();
  }

  async startGame() {
    const { error } = await supabase.rpc("start_one_vs_one_game", {
      p_room_id: this.roomId,
    });

    if (error) throw error;

    return this.getSnapshot();
  }

  processBotTurn() {
    return processDominoOneVsOneBotTurn(this.roomId);
  }

  async dispatch(command: DominoOneVsOneCommand) {
    if (command.type === "play") {
      return submitDominoOneVsOneMove(
        this.roomId,
        command.tile,
        command.branch,
      );
    }

    if (command.type === "draw") {
      return submitDominoOneVsOneDraw(this.roomId);
    }

    if (command.type === "pass") {
      return submitDominoOneVsOnePass(this.roomId);
    }

    if (command.type === "timeout-draw") {
      return submitDominoOneVsOneDraw(
        this.roomId,
        true,
        command.claim,
      );
    }

    return submitDominoOneVsOnePass(
      this.roomId,
      true,
      command.claim,
    );
  }

  subscribe(observer: DominoOneVsOneSubscription) {
    const roomChannel = supabase
      .channel(`domino-1v1:${this.roomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "one_vs_one_rooms",
          filter: `id=eq.${this.roomId}`,
        },
        (payload) => observer.onRoomInvalidated(payload.new),
      )
      .subscribe((status, error) =>
        observer.onStatus?.("rooms", status, error),
      );

    const playersChannel = supabase
      .channel(`one_vs_one_players:${this.roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "one_vs_one_players",
          filter: `room_id=eq.${this.roomId}`,
        },
        () => observer.onRosterInvalidated(),
      )
      .subscribe((status, error) =>
        observer.onStatus?.("players", status, error),
      );

    const movesChannel = supabase
      .channel(`one_vs_one_moves:${this.roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "one_vs_one_moves",
          filter: `room_id=eq.${this.roomId}`,
        },
        (payload) => {
          if ((payload.new as any)?.action === "manual_leave_takeover") {
            observer.onTakeoverInvalidated();
          }
        },
      )
      .subscribe((status, error) =>
        observer.onStatus?.("moves", status, error),
      );

    return () => {
      void supabase.removeChannel(roomChannel).catch((error) => {
        console.warn(
          "Failed to remove 1v1 room realtime channel",
          error,
        );
      });

      void supabase.removeChannel(playersChannel).catch((error) => {
        console.warn(
          "Failed to remove 1v1 players realtime channel",
          error,
        );
      });

      void supabase.removeChannel(movesChannel).catch((error) => {
        console.warn(
          "Failed to remove 1v1 moves realtime channel",
          error,
        );
      });
    };
  }

  reconnect() {
    return this.getSnapshot();
  }

  async leave() {
    const { error } = await supabase.rpc("leave_one_vs_one_match", {
      p_room_id: this.roomId,
    });

    if (error) throw error;
  }
}
