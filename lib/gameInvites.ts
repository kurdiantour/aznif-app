import type { AvatarId } from "@/types/avatar.ts";

import { supabase } from "./supabase";

export type GameInvite = {
  id: string;
  senderId: string;
  recipientId: string;
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  roomId: string | null;
  createdAt: string;
  expiresAt: string;
  senderName: string;
  senderPlayerId: string;
  senderAvatarId?: AvatarId;
  senderAvatarUrl?: string;
};

export async function getPendingGameInvites(): Promise<GameInvite[]> {
  const { data, error } = await supabase.rpc("get_pending_game_invites");

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    status: row.status,
    roomId: row.room_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    senderName: row.sender_username,
    senderPlayerId: row.sender_player_id,

    senderAvatarId:
      typeof row.sender_avatar_id === "string" && row.sender_avatar_id.trim()
        ? (row.sender_avatar_id as AvatarId)
        : undefined,

    senderAvatarUrl:
      typeof row.sender_avatar_url === "string" &&
      row.sender_avatar_url.trim()
        ? row.sender_avatar_url
        : undefined,
  }));
}

export async function sendGameInvite(recipientId: string) {
  const { data, error } = await supabase.rpc("send_game_invite", {
    p_recipient_id: recipientId,
  });

  if (error) throw new Error(error.message);

  return data;
}

export async function respondGameInvite(
  inviteId: string,
  accept: boolean,
) {
  const { data, error } = await supabase.rpc("respond_game_invite", {
    p_invite_id: inviteId,
    p_accept: accept,
  });

  if (error) throw error;

  return data as {
    status: string;
    party_id?: string;
    leader_id?: string;
  };
}

export async function cancelGameInvite(inviteId: string) {
  const { data, error } = await supabase.rpc("cancel_game_invite", {
    p_invite_id: inviteId,
  });

  if (error) throw error;

  return data;
}