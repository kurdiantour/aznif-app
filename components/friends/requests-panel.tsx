import {
  getFriendRequests,
  respondFriendRequest,
  type FriendRequest,
} from "@/lib/friends";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/supabaseAuth";
import { useFocusEffect } from "expo-router/react-navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PlayerAvatar } from "@/components/player/PlayerAvatar";

type RequestsPanelProps = {
  onRequestsChanged?: (count: number) => void;
};

function RequestCard({
  request,
  onRespond,
  busy,
}: {
  request: FriendRequest;
  onRespond: (request: FriendRequest, accept: boolean) => void;
  busy: boolean;
}) {
  return (
    <View style={styles.requestCard}>
      <PlayerAvatar
        avatarId={request.avatarId}
        size={42}
        style={styles.requestAvatar}
      />

<View style={styles.info}>
  <Text style={styles.playerName} numberOfLines={1}>
    ({request.name})
  </Text>

  <Text style={styles.requestText} numberOfLines={1}>
    داواکاری هاوڕێیەتی بۆ ناردوویت
  </Text>
</View>

      <View style={styles.requestButtons}>
        <Pressable
          style={[styles.smallButton, styles.acceptButton]}
          disabled={busy}
          onPress={() => onRespond(request, true)}
        >
          <Text style={styles.buttonText}>قبووڵکردن</Text>
        </Pressable>

        <Pressable
          style={styles.smallButton}
          disabled={busy}
          onPress={() => onRespond(request, false)}
        >
          <Text style={styles.buttonText}>ڕەتکردنەوە</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function RequestsPanel({ onRequestsChanged }: RequestsPanelProps) {
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const nextRequests = await getFriendRequests();
    setRequests(nextRequests);
    onRequestsChanged?.(nextRequests.length);
  }, [onRequestsChanged]);

  useEffect(() => {
    let mounted = true;

    setLoading(true);

    refresh()
      .catch((err) => {
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load friend requests.",
          );
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      setError(null);
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    getCurrentUser().then((user) => {
      if (!mounted || !user) return;

      channel = supabase
        .channel(`friend-requests-panel:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "friendships",
            filter: `addressee_id=eq.${user.id}`,
          },
          () => {
            void refresh();
          },
        )
        .subscribe();
    });

    return () => {
      mounted = false;

      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [refresh]);

  async function handleRespond(request: FriendRequest, accept: boolean) {
    setBusyId(request.friendshipId);
    setError(null);

    try {
      await respondFriendRequest(request.friendshipId, accept);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update friend request.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.fullWidthSection}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {loading ? (
          <ActivityIndicator
            color="#a855f7"
            size="large"
            style={styles.loader}
          />
        ) : requests.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>هیچ داواکارییەک نییە</Text>

            <Text style={styles.emptyText}>
              ئەگەر کەسێک داواکاری هاوڕێیەتی بنێرێت، لێرە پیشان دەدرێت.
            </Text>
          </View>
        ) : (
          requests.map((request) => (
            <RequestCard
              key={request.friendshipId}
              request={request}
              busy={busyId === request.friendshipId}
              onRespond={handleRespond}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
    paddingBottom: 18,
  },

  fullWidthSection: {
    flex: 1,
    width: "100%",
  },

  requestCard: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(170,105,255,0.28)",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "transparent",
  },

  requestAvatar: {
    borderRadius: 21,
  },

  info: {
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-start",
    minWidth: 0,
  },

  name: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "RobotoMedium",
  },

  playerId: {
    marginTop: 5,
    color: "#aaa7bc",
    fontSize: 12,
    fontFamily: "RobotoMedium",
  },

  requestButtons: {
    width: 150,
    flexDirection: "row",
    gap: 6,
  },

  smallButton: {
    minWidth: 68,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 8,
    backgroundColor: "transparent",
    paddingHorizontal: 8,
  },

  acceptButton: {
    borderColor: "rgba(34,197,94,0.55)",
    backgroundColor: "rgba(34,197,94,0.16)",
  },

  buttonText: {
    color: "#ffffff",
    fontSize: 10,
    fontFamily: "SpedaBold",
  },

  loader: {
    width: "100%",
    marginTop: 40,
  },

  emptyBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },

  emptyTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
    marginBottom: 8,
    textAlign: "center",
  },

  emptyText: {
    color: "#9ca3af",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    lineHeight: 19,
  },

requestText: {
  color: "#ffffff",
  fontSize: 12,
  fontFamily: "SpedaBold",
},

playerName: {
  color: "#ffffff",
  fontSize: 13,
  fontFamily: "RobotoMedium",
  marginBottom: 5,
},

  errorText: {
    width: "100%",
    color: "#ff8a8a",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },
});