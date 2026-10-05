import { FriendsPanel } from "@/components/friends/friends-panel";
import { RequestsPanel } from "@/components/friends/requests-panel";
import { SendChipPopupContext } from "@/components/friends/send-chip-popup";
import { TransfersPanel } from "@/components/friends/transfers-panel";
import { getFriendRequests } from "@/lib/friends";
import { useAuthState } from "@/lib/auth-state";
import { supabase } from "@/lib/supabase";
import { useFocusEffect } from "expo-router/react-navigation";
import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { useCallback, useContext, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

type TabKey = "friends" | "requests" | "transfers";

const tabs: { key: TabKey; label: string }[] = [
  { key: "friends", label: "هاوڕێکان" },
  { key: "requests", label: "داواکارییەکان" },
  { key: "transfers", label: "گواستنەوەکان" },
];

let friendRequestChannelSequence = 0;

export default function InviteFriendsScreen() {
  const { userId, authReady } = useAuthState();
  const [activeTab, setActiveTab] = useState<TabKey>("friends");
  const [searchQuery, setSearchQuery] = useState("");
  const [requestCount, setRequestCount] = useState(0);
  const [transferSuccessSignal, setTransferSuccessSignal] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const { showSendChipPopup } = useContext(SendChipPopupContext);

  const refreshRequestCount = useCallback(async () => {
    if (!userId) return;

    const requests = await getFriendRequests(userId);
    setRequestCount(requests.length);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void refreshRequestCount();
    }, [refreshRequestCount]),
  );

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 5000);

    return () => clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const channelId = ++friendRequestChannelSequence;

    async function subscribeToFriendRequestCount() {
      if (!userId || !mounted) return;

      const channelPrefix = `realtime:friend-request-count:${userId}`;
      const staleChannels = supabase
        .getChannels()
        .filter((existingChannel) =>
          existingChannel.topic.startsWith(channelPrefix),
        );

      await Promise.all(
        staleChannels.map((existingChannel) =>
          supabase.removeChannel(existingChannel),
        ),
      );

      if (!mounted) return;

      channel = supabase
        .channel(`friend-request-count:${userId}:${channelId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "friendships",
            filter: `addressee_id=eq.${userId}`,
          },
          () => {
            void refreshRequestCount();
          },
        )
        .subscribe();
    }

    void subscribeToFriendRequestCount();

    return () => {
      mounted = false;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [userId, refreshRequestCount]);

  if (authReady && !userId) {
    return <Redirect href="/login" />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <View style={styles.sidebar}>
          <View style={styles.searchBox}>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="ناوی یاریزان یان ناسنامە..."
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>

          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;

            return (
              <Pressable
                key={tab.key}
                style={[
                  styles.sidebarItem,
                  isActive && styles.sidebarItemActive,
                ]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Text
                  style={[
                    styles.sidebarText,
                    isActive && styles.sidebarTextActive,
                  ]}
                >
                  {tab.label}
                </Text>
                {tab.key === "requests" && requestCount > 0 ? (
                  <View style={styles.requestBadge} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.content}>
          {activeTab === "friends" ? (
            <FriendsPanel
              searchQuery={searchQuery}
              onSendChip={(friend) =>
                showSendChipPopup(friend, () =>
                  setTransferSuccessSignal((current) => current + 1),
                )
              }
              transferSuccessSignal={transferSuccessSignal}
              onToast={setToastMessage}
            />
          ) : activeTab === "requests" ? (
            <RequestsPanel onRequestsChanged={setRequestCount} />
          ) : (
            <TransfersPanel />
          )}
        </View>
      </View>

      {toastMessage ? (
        <View
          pointerEvents="none"
          style={[
            styles.toast,
            toastMessage.startsWith("بانگهێشت بۆ") &&
              styles.inviteSuccessToast,
          ]}
        >
          <Ionicons
            name={
              toastMessage.startsWith("بانگهێشت بۆ")
                ? "checkmark-circle-outline"
                : "alert-circle-outline"
            }
            size={18}
            color={
              toastMessage.startsWith("بانگهێشت بۆ")
                ? "#86efac"
                : "#fca5a5"
            }
          />

          {toastMessage.startsWith("بانگهێشت بۆ") ? (
            <Text style={[styles.toastText, styles.inviteSuccessText]}>
              بانگهێشت بۆ{" "}
              <Text style={styles.inviteUsername}>
                ({toastMessage.replace(/^بانگهێشت بۆ\s*/, "").replace(/\s*نێردرا\.$/, "")})
              </Text>{" "}
              نێردرا.
            </Text>
          ) : (
            <Text style={styles.toastText}>{toastMessage}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },

  body: {
    flex: 1,
    flexDirection: "row",
    gap: 12,
  },

  sidebar: {
    width: 150,
    gap: 10,
    paddingTop: 2,
  },

  searchBox: {
    height: 36,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "rgba(255,255,255,0.04)",
    justifyContent: "center",
    paddingHorizontal: 12,
  },

  searchInput: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "SpedaBold",
    padding: 0,
  },

  sidebarItem: {
    height: 36,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  sidebarItemActive: {
    borderColor: "rgba(255, 184, 64, 0.85)",
    backgroundColor: "rgba(28, 17, 52, 0.35)",
  },

  sidebarText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },

  sidebarTextActive: {
    color: "#ffffff",
  },

  requestBadge: {
    position: "absolute",
    top: 8,
    right: 10,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#ef4444",
  },

  content: {
    flex: 1,
  },

  toast: {
    position: "absolute",
    bottom: 90,
    alignSelf: "center",
    zIndex: 100,
    elevation: 20,
    maxWidth: "90%",
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.35)",
    backgroundColor: "rgba(20,18,29,0.96)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  toastText: {
    color: "#f1e1e1",
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center",
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
  },

  inviteSuccessToast: {
    borderColor: "rgba(34,197,94,0.45)",
  },

  inviteSuccessText: {
    color: "#86efac",
  },

  inviteUsername: {
    color: "#86efac",
    fontFamily: "RobotoMedium",
  },
});
