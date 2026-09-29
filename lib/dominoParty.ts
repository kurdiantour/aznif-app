import { getAuthState, requireReadySession } from "./auth-state";
import type { AvatarId } from "@/types/avatar";
import { supabase } from "./supabase";

export type DominoParty = {
  id: string;
  leaderId: string;
  flowStatus: "idle" | "matchmaking";
  currentGame: "domino" | "okey" | null;
  currentRoomId: string | null;
  currentMode: "2v2" | null;
  currentCurrency: "fun" | "aznif" | null;
  currentEntryFee: number | null;
  currentTableId: string | null;
  commandVersion: number;
  updatedAt: string;
  members: {
    userId: string;
    role: "leader" | "member";
    avatarId?: AvatarId;
    avatarUrl?: string;
    name: string;
  }[];
};

function mapParty(row: any): DominoParty | null {
  if (!row?.id) return null;

  return {
    id: String(row.id),
    leaderId: String(row.leader_id),
    flowStatus: row.flow_status === "matchmaking" ? "matchmaking" : "idle",
    currentGame:
      row.current_game === "okey"
        ? "okey"
        : row.current_game === "domino"
          ? "domino"
          : null,
    currentRoomId: row.current_room_id
      ? String(row.current_room_id)
      : null,
    currentMode: row.current_mode === "2v2" ? "2v2" : null,
    currentCurrency:
      row.current_currency === "aznif"
        ? "aznif"
        : row.current_currency === "fun"
          ? "fun"
          : null,
    currentEntryFee:
      typeof row.current_entry_fee === "number"
        ? row.current_entry_fee
        : row.current_entry_fee == null
          ? null
          : Number(row.current_entry_fee),
    currentTableId: row.current_table_id
      ? String(row.current_table_id)
      : null,
    commandVersion: Number(row.command_version ?? 0),
    updatedAt: String(row.updated_at ?? ""),
    members: (row.members ?? []).map((member: any) => ({
      userId: String(member.user_id),
      role: member.role === "leader" ? "leader" : "member",
      avatarId: member.avatar_id ?? undefined,
      avatarUrl:
        typeof member.avatar_url === "string" && member.avatar_url.trim()
          ? member.avatar_url
          : undefined,
      name: String(member.name ?? member.user_id),
    })),
  };
}

export async function getMyDominoParty(): Promise<DominoParty | null> {
  const auth = requireReadySession();
  const { data, error } = await supabase.rpc("get_my_domino_party");

  if (getAuthState().generation !== auth.generation) throw new Error("Session changed during Party request.");
  if (error) throw error;

  return mapParty(data);
}

export async function cancelMyGameParty() {
  const auth = requireReadySession();
  const { data, error } = await supabase.rpc("cancel_game_party");

  if (getAuthState().generation !== auth.generation) throw new Error("Session changed during Party request.");
  if (error) throw error;

  return data as {
    status: "cancelled" | "already_cancelled";
    party_id?: string;
  };
}