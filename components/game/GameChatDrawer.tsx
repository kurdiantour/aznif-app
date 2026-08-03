import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { AvatarId } from "@/constants/avatars";
import {
  getGameChatMessages,
  sendGameChatMessage,
  type GameChatMessage,
  type GameChatMode,
} from "@/lib/gameChat";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type GameChatDrawerProps = {
  visible: boolean;
  mode: GameChatMode;
  roomId: string;
  currentUserId?: string | null;
  enabled?: boolean;
  onClose: () => void;
};

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function mergeMessages(
  current: GameChatMessage[],
  incoming: GameChatMessage,
) {
  if (current.some((message) => message.id === incoming.id)) {
    return current;
  }

  return [...current, incoming].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  );
}
const QUICK_CHAT_MESSAGES = [
  "سڵاو",
  "باشە",
  "زۆر جوانە",
  "خێرا بکە",
];

export default function GameChatDrawer({
  visible,
  mode,
  roomId,
  currentUserId,
  enabled = true,
  onClose,
}: GameChatDrawerProps) {
  const [messages, setMessages] = useState<GameChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const inputRef = useRef<TextInput | null>(null);
  const listRef = useRef<FlatList<GameChatMessage> | null>(null);
  const canSend = useMemo(
    () => enabled && !!roomId && draft.trim().length > 0 && !sending,
    [draft, enabled, roomId, sending],
  );
  const showUnavailableMessage = !enabled;
  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  function dismissKeyboardOnly() {
    inputRef.current?.blur();
    Keyboard.dismiss();
    setInputFocused(false);
    setKeyboardVisible(false);
  }

  function handleBackdropPress() {
    if (inputFocused || keyboardVisible) {
      dismissKeyboardOnly();
      return;
    }

    setDraft("");
    onClose();
  }

  useEffect(() => {
    if (!visible || !enabled || !roomId) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    getGameChatMessages(mode, roomId)
      .then((nextMessages) => {
        if (isMounted) setMessages(nextMessages);
      })
      .catch((err) => {
        console.warn("Failed to load game chat messages", err);
        if (isMounted) setError("نەتوانرا پەیامەکان باربکرێن.");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    const channel = supabase
      .channel(`game_chat_messages:${mode}:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "game_chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const message = payload.new as GameChatMessage;
          if (message.mode !== mode) return;
          setMessages((current) => mergeMessages(current, message));
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [enabled, mode, roomId, visible]);


  useEffect(() => {
    if (!visible || messages.length === 0) return;

    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 50);

    return () => clearTimeout(timer);
  }, [messages.length, visible]);
  if (!visible) return null;

  async function sendMessageText(text: string, clearDraft: boolean) {
    if (!enabled || !roomId || !text || sending) return;

    setSending(true);
    setError(null);

    try {
      const sentMessage = await sendGameChatMessage(mode, roomId, text);
      setMessages((current) => mergeMessages(current, sentMessage));
      if (clearDraft) setDraft("");
      Keyboard.dismiss();
    } catch (err) {
      console.warn("Failed to send game chat message", err);
      setError("نەتوانرا پەیامەکە بنێردرێت.");
    } finally {
      setSending(false);
    }
  }

  function sendMessage() {
    void sendMessageText(draft.trim(), true);
  }

  function sendQuickMessage(text: string) {
    void sendMessageText(text, false);
  }
  return (
    <View style={styles.overlay}>
      <Pressable
        accessibilityLabel="داخستنی گفتوگۆی یاری"
        style={styles.backdrop}
        onPress={handleBackdropPress}
      />

      <Pressable
        style={styles.panel}
        onPress={(event) => {
          event.stopPropagation();
          dismissKeyboardOnly();
        }}
      >
        <BlurView
          intensity={88}
          tint="dark"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.content}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#f8f3df" size="small" />
            </View>
          ) : null}

          {showUnavailableMessage ? (
            <Text style={styles.emptyText}>گفتوگۆ تەنها لە یارییە سەرهێڵییەکان کار دەکات.</Text>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              const isMine = item.sender_user_id === currentUserId;

              return (
                <View
                  style={[
                    styles.messageRow,
                    isMine ? styles.myMessageRow : styles.otherMessageRow,
                  ]}
                >
                  {!isMine ? (
                    <PlayerAvatar
                      avatarId={item.sender_avatar_id as AvatarId | undefined}
                      size={28}
                      style={styles.avatar}
                    />
                  ) : null}

                  <View
                    style={[
                      styles.bubble,
                      isMine ? styles.userBubble : styles.otherBubble,
                    ]}
                  >
                    <View style={styles.messageMetaRow}>
                      {!isMine ? (
                        <Text numberOfLines={1} style={styles.senderName}>
                          {item.sender_name}
                        </Text>
                      ) : null}
                      <Text style={styles.messageTime}>{formatMessageTime(item.created_at)}</Text>
                    </View>

                    <Text style={styles.messageText}>{item.body}</Text>
                  </View>

                  {isMine ? (
                    <PlayerAvatar
                      avatarId={item.sender_avatar_id as AvatarId | undefined}
                      size={28}
                      style={styles.avatar}
                    />
                  ) : null}
                </View>
              );
            }}
          />


          <View style={styles.quickMessages}>
            {QUICK_CHAT_MESSAGES.map((message) => (
              <Pressable
                key={message}
                style={styles.quickMessageButton}
                onPress={() => sendQuickMessage(message)}
                disabled={sending || !enabled || !roomId}
              >
                <Text style={styles.quickMessageText}>{message}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.composer}>
            <Pressable
              style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
              onPress={sendMessage}
              disabled={!canSend}
            >
              {sending ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Ionicons name="send" size={16} color="#ffffff" />
              )}
            </Pressable>

            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="ناردنی پەیام"
              placeholderTextColor="rgba(255,255,255,0.42)"
              style={styles.input}
              textAlign="right"
              multiline
              blurOnSubmit={false}
              submitBehavior="submit"
              onSubmitEditing={sendMessage}
              editable={enabled && !!roomId && !sending}
              maxLength={500}
            />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    direction: "ltr",
    zIndex: 950,
    elevation: 950,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(9, 3, 18, 0.24)",
  },
  panel: {
    width: "50%",
    maxWidth: "100%",
    height: "100%",
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
    padding: 18,
    overflow: "hidden",
    backgroundColor: "rgba(58, 25, 92, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 20,
  },
  content: {
    flex: 1,
    paddingTop: 15,
  },
  loadingRow: {
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    marginBottom: 8,
    color: "rgba(248,243,239,0.7)",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  errorText: {
    marginBottom: 8,
    color: "#fca5a5",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  messages: {
    gap: 8,
    paddingBottom: 10,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  myMessageRow: {
    justifyContent: "flex-end",
  },
  otherMessageRow: {
    justifyContent: "flex-start",
  },
  avatar: {
    borderWidth: 1,
    borderColor: "rgba(250,204,21,0.58)",
  },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  userBubble: {},
  otherBubble: {},
  messageMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 3,
  },  senderName: {
    flexShrink: 1,
    color: "#f8d774",
    fontSize: 10,
    fontFamily: "SpedaRegular",
    textAlign: "left",
  },
  messageText: {
    color: "#ffffff",
    fontSize: 12,
    lineHeight: 20,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
  },
  messageTime: {
    flexShrink: 0,
    color: "rgba(248,243,223,0.48)",
    fontSize: 9,
    lineHeight: 12,
    fontFamily: "SpedaRegular",
    textAlign: "left",
  },  quickMessages: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 6,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  quickMessageButton: {
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  quickMessageText: {
    color: "#f8f3df",
    fontSize: 11,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
  },  composer: {
    flexDirection: "row-reverse",
    alignItems: "flex-end",
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 88,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#ffffff",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    fontSize: 12,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
});