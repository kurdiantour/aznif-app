import { LinearGradient } from "expo-linear-gradient";
import {
  GAME_CHAT_EMOJIS,
  getGameChatMessages,
  sendGameChatMessage,
  type GameChatMessage,
  type GameChatMode,
  type GameChatType,
} from "@/lib/gameChat";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
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
  realtimeMessages: GameChatMessage[];
  onClose: () => void;
};

function isEmojiOnly(text: string) {
  const value = text.trim();

  if (!value) return false;

  return /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+$/u.test(
    value,
  );
}

function mergeMessages(
  current: GameChatMessage[],
  incoming: GameChatMessage[],
) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  );
}

function belongsToMatch(
  message: GameChatMessage,
  gameType: GameChatType,
  matchId: string,
  mode: GameChatMode | null,
) {
  return (
    message.game_type === gameType &&
    message.match_id === matchId &&
    (mode === null || message.mode === mode)
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

function getCurrentTimestamp() {
  return new Date().getTime();
}

export default function GameChatDrawer(props: GameChatDrawerProps) {
  return (
    <GameChatDrawerMatch
      key={JSON.stringify([props.gameType, props.matchId, props.mode ?? null])}
      {...props}
    />
  );
}

function GameChatDrawerMatch({
  visible,
  gameType,
  matchId,
  mode = null,
  currentUserId,
  enabled = true,
  realtimeMessages,
  onClose,
}: GameChatDrawerProps) {
  const [messages, setMessages] = useState<GameChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldownActive, setCooldownActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const inputRef = useRef<TextInput | null>(null);
  const listRef = useRef<FlatList<GameChatMessage> | null>(null);
  const cooldownUntilRef = useRef(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);
  const displayedMessages = useMemo(
    () => mergeMessages(
      messages,
      realtimeMessages.filter((message) =>
        belongsToMatch(message, gameType, matchId, mode),
      ),
    ),
    [gameType, matchId, messages, mode, realtimeMessages],
  );

  const canSend = useMemo(
    () =>
      enabled &&
      !!matchId &&
      draft.trim().length > 0 &&
      !sending &&
      !cooldownActive,
    [cooldownActive, draft, enabled, matchId, sending],
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

  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
      }
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

    getGameChatMessages(gameType, matchId, mode)
      .then((nextMessages) => {
        if (isMounted && activeRef.current) {
          setMessages((current) => mergeMessages(
            current,
            nextMessages.filter((message) =>
              belongsToMatch(message, gameType, matchId, mode),
            ),
          ));
        }
      })
      .catch((err) => {
        console.warn(
          "Failed to load game chat messages",
          err,
        );

        if (isMounted && activeRef.current) {
          setError("نەتوانرا پەیامەکان باربکرێن.");
        }
      })
      .finally(() => {
        if (isMounted && activeRef.current) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      clearTimeout(loadingTimer);
    };
  }, [enabled, gameType, matchId, mode, visible]);

  useEffect(() => {
    if (!visible || displayedMessages.length === 0) {
      return;
    }

    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({
        animated: true,
      });
    }, 50);

    return () => clearTimeout(timer);
  }, [displayedMessages.length, visible]);

  if (!visible) {
    return null;
  }

  async function sendMessageText(
    text: string,
    clearDraft: boolean,
  ) {
    if (
      !enabled ||
      !matchId ||
      !text ||
      sending ||
      getCurrentTimestamp() < cooldownUntilRef.current
    ) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      const sentMessage = await sendGameChatMessage(gameType, matchId, text, mode);

      if (
        !activeRef.current ||
        !belongsToMatch(sentMessage, gameType, matchId, mode)
      ) return;

      setMessages((current) =>
        mergeMessages(current, [sentMessage]),
      );

      cooldownUntilRef.current =
        getCurrentTimestamp() + 3000;

      setCooldownActive(true);

      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
      }

      cooldownTimerRef.current = setTimeout(() => {
        if (!activeRef.current) return;
        cooldownUntilRef.current = 0;
        setCooldownActive(false);
        cooldownTimerRef.current = null;
      }, 3000);

      if (clearDraft) {
        setDraft("");
      }

      Keyboard.dismiss();
      onClose();
    } catch (err) {
      console.warn(
        "Failed to send game chat message",
        err,
      );

      if (activeRef.current) {
        setError("نەتوانرا پەیامەکە بنێردرێت.");
      }
    } finally {
      if (activeRef.current) setSending(false);
    }
  }

  function sendMessage() {
    void sendMessageText(draft.trim(), true);
  }

  function sendQuickMessage(text: string) {
    void sendMessageText(text, false);
  }

  return (
    <KeyboardAvoidingView
      behavior="height"
      style={styles.overlay}
    >
      <Pressable
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
                data={displayedMessages}
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
                      <View
                        style={[
                          styles.bubble,
                          isMine
                            ? styles.userBubble
                            : styles.otherBubble,
                        ]}
                      >
                        {!isMine ? (
                          <Text
                            numberOfLines={1}
                            style={styles.senderName}
                          >
                            {item.sender_name}
                          </Text>
                        ) : null}

                        <Text
                          style={[
                            styles.messageText,
                            isEmojiOnly(item.body) &&
                              styles.emojiMessageText,
                          ]}
                        >
                          {item.body}
                        </Text>
                      </View>
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
                    cooldownActive ||
                    !enabled ||
                    !matchId
                  }
                >
                  <Text style={styles.quickMessageText}>
                    {message}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={styles.emojiBar}>
            {[...GAME_CHAT_EMOJIS].map((emoji) => (
              <Pressable
                key={emoji}
                style={styles.quickEmojiButton}
                onPress={() =>
                  sendQuickMessage(emoji)
                }
                disabled={
                  sending ||
                  cooldownActive ||
                  !enabled ||
                  !matchId
                }
              >
                <Text style={styles.quickEmojiText}>
                  {emoji}
                </Text>
              </Pressable>
            ))}
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
    </KeyboardAvoidingView>
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

  emojiBar: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },

  quickEmojiButton: {
    flex: 1,
    minWidth: 0,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },

  quickEmojiText: {
    fontSize: 24,
    lineHeight: 30,
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

  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 0,
    paddingVertical: 0,
  },

  userBubble: {},

  otherBubble: {},

  senderName: {
    flexShrink: 1,
    marginBottom: 3,
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

  emojiMessageText: {
    fontSize: 18,
    lineHeight: 24,
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
