import type { AvatarId } from "@/constants/avatars";
import { supabase } from "@/lib/supabase";

export type GameChatMode = "1v1" | "2v2";

export type GameChatMessage = {
  id: string;
  mode: GameChatMode;
  room_id: string;
  sender_user_id: string;
  sender_name: string;
  sender_avatar_id: AvatarId | null;
  sender_avatar_url?: string | null;
  body: string;
  created_at: string;
};

const GAME_CHAT_SELECT =
  "id, mode, room_id, sender_user_id, sender_name, sender_avatar_id, body, created_at";

export async function getGameChatMessages(
  mode: GameChatMode,
  roomId: string,
): Promise<GameChatMessage[]> {
  const { data, error } = await supabase
    .from("game_chat_messages")
    .select(GAME_CHAT_SELECT)
    .eq("mode", mode)
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw error;

  return (data ?? []) as GameChatMessage[];
}

export async function sendGameChatMessage(
  mode: GameChatMode,
  roomId: string,
  body: string,
): Promise<GameChatMessage> {
  const { data, error } = await supabase.rpc("send_game_chat_message", {
    p_mode: mode,
    p_room_id: roomId,
    p_body: body,
  });

  if (error) throw error;

  return data as GameChatMessage;
}