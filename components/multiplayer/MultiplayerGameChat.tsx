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

import GameChatBubble, { type GameChatBubbleSeat } from "@/components/multiplayer/GameChatBubble";
import GameChatDrawer from "@/components/multiplayer/GameChatDrawer";
import {
  GAME_CHAT_EMOJIS,
  type GameChatMessage,
  type GameChatMode,
  type GameChatType,
} from "@/lib/gameChat";
import { supabase } from "@/lib/supabase";

type SeatMessage = { id: string; body: string; isEmoji: boolean };
type SeatMessages = Partial<Record<GameChatBubbleSeat, SeatMessage>>;

const SEATS: readonly GameChatBubbleSeat[] = ["bottom", "right", "top", "left"];

type MultiplayerGameChatProps = {
  gameType: GameChatType;
  matchId?: string;
  mode?: GameChatMode | null;
  currentUserId?: string | null;
  playerIdBySeat: Partial<Record<GameChatBubbleSeat, string>>;
  enabled: boolean;
  triggerVisible?: boolean;
  triggerStyle?: StyleProp<ViewStyle>;
  topSeatRect?: { x: number; y: number; width: number; height: number } | null;
  leftSeatRect?: { x: number; y: number; width: number; height: number } | null;
  rightSeatRect?: { x: number; y: number; width: number; height: number } | null;
};

export default function MultiplayerGameChat(props: MultiplayerGameChatProps) {
  return (
    <MultiplayerGameChatMatch
      key={JSON.stringify([props.gameType, props.matchId ?? "", props.mode ?? null])}
      {...props}
    />
  );
}

function MultiplayerGameChatMatch({
  gameType,
  matchId,
  mode = null,
  currentUserId,
  playerIdBySeat,
  enabled,
  triggerVisible = true,
  triggerStyle,
  topSeatRect,
  leftSeatRect,
  rightSeatRect,
}: MultiplayerGameChatProps) {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [seatMessages, setSeatMessages] = useState<SeatMessages>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [realtimeMessages, setRealtimeMessages] = useState<GameChatMessage[]>([]);
  const receivedMessageIdsRef = useRef(new Set<string>());
  const drawerVisibleRef = useRef(false);
  const chatLayerRef = useRef<View | null>(null);
  const [chatLayerOrigin, setChatLayerOrigin] = useState<{ x: number; y: number } | null>(null);
  const measureChatLayer = useCallback(() => {
    chatLayerRef.current?.measureInWindow((x, y) => {
      setChatLayerOrigin((current) =>
        current?.x === x && current.y === y ? current : { x, y },
      );
    });
  }, []);
  const usesMeasuredSeatAnchors = topSeatRect !== undefined;
  const seatRects = { top: topSeatRect, left: leftSeatRect, right: rightSeatRect } as const;

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

  const clearSeatMessage = useCallback((seat: GameChatBubbleSeat, messageId: string) => {
    setSeatMessages((current) => {
      if (current[seat]?.id !== messageId) return current;
      const next = { ...current };
      delete next[seat];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!matchId || !enabled) {
      const reset = setTimeout(() => setSeatMessages({}), 0);
      return () => clearTimeout(reset);
    }

    let active = true;
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
          if (!active) return;
          const message = payload.new as GameChatMessage;
          if (
            message.game_type !== gameType ||
            message.match_id !== matchId ||
            (mode !== null && message.mode !== mode)
          ) return;
          if (receivedMessageIdsRef.current.has(message.id)) return;
          receivedMessageIdsRef.current.add(message.id);

          setRealtimeMessages((current) => [...current, message]);
          if (message.sender_user_id !== currentUserId && !drawerVisibleRef.current) {
            setUnreadCount((count) => Math.min(count + 1, 99));
          }
          const seat = seatByPlayerId.get(message.sender_user_id);
          if (!seat) return;
          const body = message.body.trim();
          setSeatMessages((current) => ({
            ...current,
            [seat]: { id: message.id, body, isEmoji: GAME_CHAT_EMOJIS.has(body) },
          }));
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, enabled, gameType, matchId, mode, seatByPlayerId]);

  return (
    <View
      ref={chatLayerRef}
      collapsable={false}
      onLayout={measureChatLayer}
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, drawerVisible && styles.drawerOpenLayer]}
    >
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
        const seatMessage = seatMessages[seat];
        const displayedMessage = seatMessage?.body;
        const measuredSeatRect = seat === "bottom" ? undefined : seatRects[seat];
        const seatAnchorReady =
          seat === "bottom" ||
          !usesMeasuredSeatAnchors ||
          (!!measuredSeatRect && !!chatLayerOrigin);
        return displayedMessage && seatAnchorReady ? (
          <GameChatBubble
            key={`${seat}:${seatMessage?.id ?? "preview"}`}
            seat={seat}
            message={displayedMessage}
            messageId={seatMessage?.id ?? `preview-chat-${seat}`}
            isEmoji={seatMessage?.isEmoji ?? false}
            seatAnchorRect={
              measuredSeatRect && chatLayerOrigin
                ? {
                    ...measuredSeatRect,
                    x: measuredSeatRect.x - chatLayerOrigin.x,
                    y: measuredSeatRect.y - chatLayerOrigin.y,
                  }
                : undefined
            }
            onComplete={seatMessage ? () => clearSeatMessage(seat, seatMessage.id) : undefined}
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
        realtimeMessages={realtimeMessages}
        onClose={() => {
          drawerVisibleRef.current = false;
          setDrawerVisible(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  drawerOpenLayer: {
    zIndex: 20000,
    elevation: 20000,
  },
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
