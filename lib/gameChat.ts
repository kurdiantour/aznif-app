import type { AvatarId } from "@/constants/avatars";
import { supabase } from "@/lib/supabase";

export type GameChatType = "domino" | "okey";
export type GameChatMode = "1v1" | "2v2";

export type GameChatMessage = {
  id: string;
  game_type: GameChatType;
  mode: GameChatMode | null;
  match_id: string;
  sender_user_id: string;
  sender_name: string;
  sender_avatar_id: AvatarId | null;
  sender_avatar_url?: string | null;
  body: string;
  created_at: string;
};

const GAME_CHAT_SELECT =
  "id, game_type, mode, match_id, sender_user_id, sender_name, sender_avatar_id, body, created_at";

export async function getGameChatMessages(
  gameType: GameChatType,
  matchId: string,
  mode: GameChatMode | null = null,
): Promise<GameChatMessage[]> {
  let query = supabase
    .from("game_chat_messages")
    .select(GAME_CHAT_SELECT)
    .eq("game_type", gameType)
    .eq("match_id", matchId);

  if (mode !== null) {
    query = query.eq("mode", mode);
  }

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw error;

  return (data ?? []) as GameChatMessage[];
}

export async function sendGameChatMessage(
  gameType: GameChatType,
  matchId: string,
  body: string,
  mode: GameChatMode | null = null,
): Promise<GameChatMessage> {
  const { data, error } = await supabase.rpc("send_game_chat_message", {
    p_game_type: gameType,
    p_match_id: matchId,
    p_body: body,
    p_mode: mode,
  });

  if (error) throw error;

  return data as GameChatMessage;
}