import { LinearGradient } from "expo-linear-gradient";
import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { AvatarId } from "@/constants/avatars";
import {
  GAME_CHAT_EMOJIS,
  getGameChatMessages,
  sendGameChatMessage,
  type GameChatMessage,
  type GameChatMode,
  type GameChatType,
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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type GameChatDrawerProps = {
  visible: boolean;
  gameType: GameChatType;
  matchId: string;
  mode?: GameChatMode | null;
  currentUserId?: string | null;
  enabled?: boolean;
  onClose: () => void;
};

function formatMessageTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

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
  "زۆر جوانە دەست خوش",
  "خێرا یاری بکەن، ئەوە چیە",
  "ئاگات لە یاری بێت کاکە",
  "باشە ئاگام لێیە برام",
  "ئاگام لێ نەبوو ببۆرە",
];

export default function GameChatDrawer({
  visible,
  gameType,
  matchId,
  mode = null,
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
    () =>
      enabled &&
      !!matchId &&
      draft.trim().length > 0 &&
      !sending,
    [draft, enabled, matchId, sending],
  );

  const showUnavailableMessage = !enabled;

  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      "keyboardDidShow",
      () => {
        setKeyboardVisible(true);
      },
    );

    const hideSubscription = Keyboard.addListener(
      "keyboardDidHide",
      () => {
        setKeyboardVisible(false);
      },
    );

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
    if (!visible || !enabled || !matchId) {
      return;
    }

    let isMounted = true;

    const loadingTimer = setTimeout(() => {
      setLoading(true);
      setError(null);
    }, 0);

    const loadMessages = () =>
      getGameChatMessages(gameType, matchId, mode);

    loadMessages()
      .then((nextMessages) => {
        if (isMounted) {
          setMessages(nextMessages);
        }
      })
      .catch((err) => {
        console.warn(
          "Failed to load game chat messages",
          err,
        );

        if (isMounted) {
          setError("نەتوانرا پەیامەکان باربکرێن.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    const channel = supabase
      .channel(
        `game_chat_messages:${gameType}:${matchId}:${mode ?? "all"}`,
      )
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

          if (message.game_type !== gameType) {
            return;
          }

          if (mode !== null && message.mode !== mode) {
            return;
          }

          setMessages((current) =>
            mergeMessages(current, message),
          );
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      clearTimeout(loadingTimer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, gameType, matchId, mode, visible]);

  useEffect(() => {
    if (!visible || messages.length === 0) {
      return;
    }

    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({
        animated: true,
      });
    }, 50);

    return () => clearTimeout(timer);
  }, [messages.length, visible]);

  if (!visible) {
    return null;
  }

  async function sendMessageText(
    text: string,
    clearDraft: boolean,
  ) {
    if (!enabled || !matchId || !text || sending) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      const sentMessage = await sendGameChatMessage(
        gameType,
        matchId,
        text,
        mode,
      );

      setMessages((current) =>
        mergeMessages(current, sentMessage),
      );

      if (clearDraft) {
        setDraft("");
      }

      Keyboard.dismiss();
    } catch (err) {
      console.warn(
        "Failed to send game chat message",
        err,
      );

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
          intensity={45}
          tint="dark"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.content}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator
                color="#f8f3df"
                size="small"
              />
            </View>
          ) : null}

          {showUnavailableMessage ? (
            <Text style={styles.emptyText}>
              گفتوگۆ تەنها لە یارییە سەرهێڵییەکان کار دەکات.
            </Text>
          ) : null}

          {error ? (
            <Text style={styles.errorText}>
              {error}
            </Text>
          ) : null}

          <View style={styles.chatBody}>
            <View style={styles.realMessagesArea}>
              <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={(item) => item.id}
                style={styles.messageList}
                contentContainerStyle={styles.messages}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() =>
                  listRef.current?.scrollToEnd({
                    animated: true,
                  })
                }
                onLayout={() =>
                  listRef.current?.scrollToEnd({
                    animated: false,
                  })
                }
                renderItem={({ item }) => {
                  const isMine =
                    item.sender_user_id === currentUserId;

                  return (
                    <View
                      style={[
                        styles.messageRow,
                        isMine
                          ? styles.myMessageRow
                          : styles.otherMessageRow,
                      ]}
                    >
                      {!isMine ? (
                        <PlayerAvatar
                          avatarId={
                            item.sender_avatar_id as
                              | AvatarId
                              | undefined
                          }
                          avatarUrl={
                            item.sender_avatar_url ??
                            undefined
                          }
                          size={28}
                          style={styles.avatar}
                        />
                      ) : null}

                      <View
                        style={[
                          styles.bubble,
                          isMine
                            ? styles.userBubble
                            : styles.otherBubble,
                        ]}
                      >
                        <View style={styles.messageMetaRow}>
                          {!isMine ? (
                            <Text
                              numberOfLines={1}
                              style={styles.senderName}
                            >
                              {item.sender_name}
                            </Text>
                          ) : null}

                          <Text style={styles.messageTime}>
                            {formatMessageTime(
                              item.created_at,
                            )}
                          </Text>
                        </View>

                        <Text style={styles.messageText}>
                          {item.body}
                        </Text>
                      </View>

                      {isMine ? (
                        <PlayerAvatar
                          avatarId={
                            item.sender_avatar_id as
                              | AvatarId
                              | undefined
                          }
                          avatarUrl={
                            item.sender_avatar_url ??
                            undefined
                          }
                          size={28}
                          style={styles.avatar}
                        />
                      ) : null}
                    </View>
                  );
                }}
              />
            </View>

<LinearGradient
  colors={[
    "rgba(255,255,255,0)",
    "rgba(255,255,255,0.10)",
    "rgba(255,255,255,0.24)",
    "rgba(255,255,255,0.10)",
    "rgba(255,255,255,0)",
  ]}
  locations={[0, 0.25, 0.5, 0.75, 1]}
  start={{ x: 0.5, y: 0 }}
  end={{ x: 0.5, y: 1 }}
  style={styles.verticalDivider}
/>

            <ScrollView
              style={styles.quickMessages}
              contentContainerStyle={
                styles.quickMessagesContent
              }
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              {QUICK_CHAT_MESSAGES.map((message) => (
                <Pressable
                  key={message}
                  style={styles.quickMessageButton}
                  onPress={() =>
                    sendQuickMessage(message)
                  }
                  disabled={
                    sending ||
                    !enabled ||
                    !matchId
                  }
                >
                  <Text style={styles.quickMessageText}>
                    {message}
                  </Text>
                </Pressable>
              ))}

              <View style={styles.quickEmojiRow}>
                {[...GAME_CHAT_EMOJIS].map((emoji) => (
                  <Pressable
                    key={emoji}
                    style={styles.quickEmojiButton}
                    onPress={() => sendQuickMessage(emoji)}
                    disabled={sending || !enabled || !matchId}
                  >
                    <Text style={styles.quickEmojiText}>
                      {emoji}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>

          <View style={styles.composer}>
            <Pressable
              style={[
                styles.sendButton,
                !canSend &&
                  styles.sendButtonDisabled,
              ]}
              onPress={sendMessage}
              disabled={!canSend}
            >
              {sending ? (
                <ActivityIndicator
                  color="#ffffff"
                  size="small"
                />
              ) : (
                <Ionicons
                  name="send"
                  size={16}
                  color="#ffffff"
                />
              )}
            </Pressable>

            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              onFocus={() =>
                setInputFocused(true)
              }
              onBlur={() =>
                setInputFocused(false)
              }
              placeholder="ناردنی پەیام"
              placeholderTextColor="rgba(255,255,255,0.42)"
              style={styles.input}
              textAlign="right"
              multiline
              blurOnSubmit={false}
              submitBehavior="submit"
              onSubmitEditing={sendMessage}
              editable={
                enabled &&
                !!matchId &&
                !sending
              }
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
    ...StyleSheet.absoluteFill,
    direction: "ltr",
    zIndex: 950,
    elevation: 950,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },

  backdrop: {
    ...StyleSheet.absoluteFill,
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
    backgroundColor: "rgba(0, 0, 0, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 8,
    },
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

  chatBody: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
  },

  realMessagesArea: {
    flex: 1,
    minWidth: 0,
  },

verticalDivider: {
  width: 2,
  height: "80%",
  alignSelf: "center",
  marginHorizontal: 10,
},

  dividerFadeTop: {
    width: 1,
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  dividerHighlight: {
    width: 1,
    height: 24,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.42)",
  },

  dividerFadeBottom: {
    width: 1,
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

quickMessages: {
  width: 150,
  flexGrow: 0,
  height: "100%",
},

  quickMessagesContent: {
    paddingBottom: 20,
  },

quickMessageButton: {
  width: "100%",
  minHeight: 30,
  justifyContent: "center",

  marginBottom: 6,
  paddingHorizontal: 8,

  backgroundColor: "rgba(255,255,255,0.045)",
},

  quickMessageText: {
    color: "#f8f3df",
    fontSize: 12,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
    textAlign: "center",
  },

  quickEmojiRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },

  quickEmojiButton: {
    flex: 1,
    minWidth: 0,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },

  quickEmojiText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },

  messageList: {
    flex: 1,
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
  },

  senderName: {
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
  },

  composer: {
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
