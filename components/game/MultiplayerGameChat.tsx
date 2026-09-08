import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import GameChatBubble, { type GameChatBubbleSeat } from "@/components/game/GameChatBubble";
import GameChatDrawer from "@/components/game/GameChatDrawer";
import {
  GAME_CHAT_EMOJIS,
  type GameChatMessage,
  type GameChatMode,
  type GameChatType,
} from "@/lib/gameChat";
import { supabase } from "@/lib/supabase";

type SeatReaction = { id: string; emoji: string };
type SeatReactions = Partial<Record<GameChatBubbleSeat, SeatReaction>>;

const SEATS: readonly GameChatBubbleSeat[] = ["bottom", "right", "top", "left"];

export default function MultiplayerGameChat({
  gameType,
  matchId,
  mode = null,
  currentUserId,
  playerIdBySeat,
  enabled,
  triggerVisible = true,
  triggerStyle,
}: {
  gameType: GameChatType;
  matchId?: string;
  mode?: GameChatMode | null;
  currentUserId?: string | null;
  playerIdBySeat: Partial<Record<GameChatBubbleSeat, string>>;
  enabled: boolean;
  triggerVisible?: boolean;
  triggerStyle?: StyleProp<ViewStyle>;
}) {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [reactions, setReactions] = useState<SeatReactions>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const drawerVisibleRef = useRef(false);

  const bottomPlayerId = playerIdBySeat.bottom;
  const rightPlayerId = playerIdBySeat.right;
  const topPlayerId = playerIdBySeat.top;
  const leftPlayerId = playerIdBySeat.left;
  const seatByPlayerId = useMemo(() => {
    const result = new Map<string, GameChatBubbleSeat>();
    const ids = [bottomPlayerId, rightPlayerId, topPlayerId, leftPlayerId];
    SEATS.forEach((seat, index) => {
      const playerId = ids[index];
      if (playerId) result.set(playerId, seat);
    });
    return result;
  }, [bottomPlayerId, leftPlayerId, rightPlayerId, topPlayerId]);

  const clearReaction = useCallback((seat: GameChatBubbleSeat, messageId: string) => {
    setReactions((current) => {
      if (current[seat]?.id !== messageId) return current;
      const next = { ...current };
      delete next[seat];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!matchId || !enabled) {
      const reset = setTimeout(() => setReactions({}), 0);
      return () => clearTimeout(reset);
    }

    const channel = supabase
      .channel(`game_chat_bubbles:${gameType}:${matchId}:${mode ?? "all"}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "game_chat_messages",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const message = payload.new as GameChatMessage;
          if (
            message.game_type !== gameType ||
            (mode !== null && message.mode !== mode) ||
            !GAME_CHAT_EMOJIS.has(message.body.trim())
          ) return;

          if (message.sender_user_id !== currentUserId && !drawerVisibleRef.current) {
            setUnreadCount((count) => Math.min(count + 1, 99));
          }
          const seat = seatByPlayerId.get(message.sender_user_id);
          if (!seat) return;
          setReactions((current) => ({
            ...current,
            [seat]: { id: message.id, emoji: message.body.trim() },
          }));
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [currentUserId, enabled, gameType, matchId, mode, seatByPlayerId]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {triggerVisible ? (
        <Pressable
          style={[styles.trigger, triggerStyle]}
          onPress={() => {
            drawerVisibleRef.current = true;
            setUnreadCount(0);
            setDrawerVisible(true);
          }}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={22} color="#f8f3df" />
          {unreadCount > 0 ? (
            <View style={styles.unreadBadge}><Text style={styles.unreadText}>{unreadCount > 9 ? "9+" : unreadCount}</Text></View>
          ) : null}
        </Pressable>
      ) : null}

      {SEATS.map((seat) => {
        const reaction = reactions[seat];
        return reaction ? (
          <GameChatBubble
            key={`${seat}:${reaction.id}`}
            seat={seat}
            message={reaction.emoji}
            messageId={reaction.id}
            isEmoji
            onComplete={() => clearReaction(seat, reaction.id)}
          />
        ) : null;
      })}

      <GameChatDrawer
        visible={drawerVisible}
        gameType={gameType}
        matchId={matchId ?? ""}
        mode={mode}
        currentUserId={currentUserId}
        enabled={enabled}
        onClose={() => {
          drawerVisibleRef.current = false;
          setDrawerVisible(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    position: "absolute",
    top: 18,
    right: 68,
    zIndex: 900,
    elevation: 900,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248,243,223,0.22)",
  },
  unreadBadge: {
    position: "absolute", top: -4, right: -4, minWidth: 18, height: 18,
    paddingHorizontal: 4, borderRadius: 9, alignItems: "center", justifyContent: "center",
    backgroundColor: "#d93b45",
  },
  unreadText: { color: "#fff", fontSize: 10, fontWeight: "800" },
});
