import type { AvatarId } from "@/constants/avatars";
import { supabase } from "./supabase";

export type GameInvite = {
  id: string;
  senderId: string;
  recipientId: string;
  mode: "1v1";
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  roomId: string | null;
  createdAt: string;
  expiresAt: string;
  senderName: string;
  senderPlayerId: string;
  senderAvatarId: AvatarId;
};

export async function getPendingGameInvites(): Promise<GameInvite[]> {
  const { data, error } = await supabase.rpc("get_pending_game_invites");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    mode: row.mode,
    status: row.status,
    roomId: row.room_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    senderName: row.sender_username,
    senderPlayerId: row.sender_player_id,
    senderAvatarId: row.sender_avatar_id,
  }));
}

export async function sendGameInvite(recipientId: string) {
  const { data, error } = await supabase.rpc("send_game_invite", {
    p_recipient_id: recipientId,
    p_mode: "1v1",
  });
  if (error) throw error;
  return data;
}

export async function respondGameInvite(inviteId: string, accept: boolean) {
  const { data, error } = await supabase.rpc("respond_game_invite", {
    p_invite_id: inviteId,
    p_accept: accept,
  });
  if (error) throw error;
  return data as { status: string; room_id?: string };
}

export async function cancelGameInvite(inviteId: string) {
  const { data, error } = await supabase.rpc("cancel_game_invite", {
    p_invite_id: inviteId,
  });
  if (error) throw error;
  return data;
}
