import {
  getFriends,
  searchFriendCandidates,
  sendFriendRequest,
  type Friend,
  type FriendSearchResult,
} from "@/lib/friends";
import { sendGameInvite } from "@/lib/gameInvites";
import { usePresence } from "@/lib/presence";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/supabaseAuth";
import { useFocusEffect } from "@react-navigation/native";
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

function FriendCard({
  friend,
  onSendChip,
  onlineAvailable,
  inviteBusy,
  onInvite,
}: {
  friend: Friend;
  onSendChip: (friend: Friend) => void;
  onlineAvailable: boolean;
  inviteBusy: boolean;
  onInvite: (friend: Friend) => void;
}) {
  return (
    <View style={styles.friendCard}>
      <View style={styles.buttonStack}>
        <Pressable
          style={styles.actionButton}
          onPress={() => onSendChip(friend)}
        >
          <Text style={styles.buttonText}>ئەزنیف بنێرە</Text>
        </Pressable>

        <Pressable
          style={[styles.actionButton, !onlineAvailable && styles.disabledButton]}
          disabled={!onlineAvailable || inviteBusy}
          onPress={() => onInvite(friend)}
        >
          <Text style={[styles.buttonText, !onlineAvailable && styles.disabledButtonText]}>
            بانگهێشت
          </Text>
        </Pressable>
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {friend.name}
        </Text>

        <Text style={styles.playerId} numberOfLines={1}>
          {friend.playerId}{" "}
        </Text>
      </View>

      <View style={[styles.avatarWrap, onlineAvailable && styles.onlineAvatarWrap]}>
        <PlayerAvatar
          avatarId={friend.avatarId}
          size={58}
          style={styles.avatar}
        />
      </View>
    </View>
  );
}

function SearchResultRow({
  result,
  onAdd,
  onSendChip,
  busy,
}: {
  result: FriendSearchResult;
  onAdd: (result: FriendSearchResult) => void;
  onSendChip: (result: FriendSearchResult) => void;
  busy: boolean;
}) {
  const isFriend = result.friendshipStatus === "accepted";
  const isPending = result.friendshipStatus === "pending";
  const label = isFriend
    ? "هاوڕێکان"
    : isPending && result.friendshipDirection === "incoming"
      ? "چاوەڕوان"
      : isPending
        ? "نێردراو"
        : "زیادکردن";

  return (
    <View style={styles.searchRow}>
      <PlayerAvatar
        avatarId={result.avatarId}
        size={38}
        style={styles.requestAvatar}
      />

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {result.name}
        </Text>
        <Text style={styles.playerId} numberOfLines={1}>
          {result.playerId}
        </Text>
      </View>

      <Pressable
        style={[
          styles.smallButton,
          !isPending && styles.acceptButton,
          isPending && styles.disabledButton,
        ]}
        disabled={busy || isPending}
        onPress={() => (isFriend ? onSendChip(result) : onAdd(result))}
      >
        <Text
          style={[
            styles.buttonText,
            isPending && styles.disabledButtonText,
          ]}
        >
          {isFriend ? "ئەزنیف بنێرە" : label}
        </Text>
      </Pressable>
    </View>
  );
}

type FriendsPanelProps = {
  searchQuery?: string;
  onSendChip?: (friend: Friend) => void;
  transferSuccessSignal?: number;
  onToast?: (message: string) => void;
};

function getMeaningfulSearchQuery(query: string) {
  const trimmed = query.trim();
  const playerCodeMatch = trimmed.match(/^dv-?(\d*)$/i);

  if (trimmed.length < 2) {
    return "";
  }

  if (playerCodeMatch && playerCodeMatch[1].length < 4) {
    return "";
  }

  return trimmed;
}

function getGameInviteToast(reason: unknown) {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof (reason as { message?: unknown })?.message === "string"
        ? String((reason as { message: string }).message)
        : "";

  if (message.toLowerCase().includes("already pending")) {
    return "بانگهێشت پێشتر نێردراوە. چاوەڕوانی وەڵام بە.";
  }

  return null;
}

export function FriendsPanel({
  searchQuery = "",
  onSendChip,
  transferSuccessSignal = 0,
  onToast,
}: FriendsPanelProps) {
  const meaningfulSearchQuery = getMeaningfulSearchQuery(searchQuery);
  const isSearchActive = searchQuery.trim().length >= 2;
  const canRunSearch = meaningfulSearchQuery.length > 0;
  const { statuses, refreshPresence } = usePresence();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [searchResults, setSearchResults] = useState<FriendSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const nextFriends = await getFriends();
    setFriends(nextFriends);
  }, []);

  useEffect(() => {
    let mounted = true;

    setLoading(true);
    refresh()
      .catch((err) => {
        console.warn("[FriendsPanel] Unable to load friends:", err);
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
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function subscribeToFriendships() {
      const user = await getCurrentUser();
      if (!mounted || !user) return;

      channel = supabase
        .channel(`friends-list:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "friendships",
            filter: `requester_id=eq.${user.id}`,
          },
          () => {
            void refresh();
          },
        )
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
    }

    void subscribeToFriendships();

    return () => {
      mounted = false;

      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [refresh]);

  useEffect(() => {
    const ids = friends.map((friend) => friend.id);
    if (ids.length === 0) return;
    void refreshPresence(ids);
    const channel = supabase
      .channel(`friends-presence:${ids.slice().sort().join(":")}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_presence" },
        () => void refreshPresence(ids),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [friends, refreshPresence]);

  useEffect(() => {
    let mounted = true;
    const handle = setTimeout(() => {
      if (!canRunSearch) {
        setSearchResults([]);
        setSearching(false);
        return;
      }

      setSearching(true);
      searchFriendCandidates(meaningfulSearchQuery)
        .then((results) => {
          if (mounted) setSearchResults(results);
        })
        .catch((err) => {
          if (mounted) {
            console.warn("[FriendsPanel] Friend search failed:", err);
          }
        })
        .finally(() => {
          if (mounted) setSearching(false);
        });
    }, 300);

    return () => {
      mounted = false;
      clearTimeout(handle);
    };
  }, [canRunSearch, meaningfulSearchQuery]);

  useEffect(() => {
    if (transferSuccessSignal === 0) return;

    handleTransferSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, transferSuccessSignal]);

  async function handleAdd(result: FriendSearchResult) {
    setBusyId(result.id);

    try {
      await sendFriendRequest(result.id);
      setSearchResults((current) =>
        current.map((item) =>
          item.id === result.id
            ? {
                ...item,
                friendshipStatus: "pending",
                friendshipDirection: "outgoing",
              }
            : item,
        ),
      );
    } catch (err) {
      console.warn("[FriendsPanel] Unable to send friend request:", err);
    } finally {
      setBusyId(null);
    }
  }

  function handleSearchTransfer(result: FriendSearchResult) {
    onSendChip?.({
      id: result.id,
      name: result.name,
      playerId: result.playerId,
      avatarId: result.avatarId,
      friendshipId: "",
    });
  }

  function handleTransferSuccess() {
    void refresh();
  }

  async function handleInvite(friend: Friend) {
    setInviteBusyId(friend.id);
    try {
      await sendGameInvite(friend.id);
      onToast?.(`بانگهێشت بۆ ${friend.name} نێردرا.`);
    } catch (err) {
      const toastMessage = getGameInviteToast(err);
      if (toastMessage) {
        onToast?.(toastMessage);
      }
      void refreshPresence([friend.id]);
    } finally {
      setInviteBusyId(null);
    }
  }

  return (
    <View style={styles.panel}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {isSearchActive ? (
          <View style={styles.fullWidthSection}>
            {searching ? (
              <ActivityIndicator color="#a855f7" style={styles.inlineLoader} />
            ) : null}

            {!canRunSearch ? null : !searching && searchResults.length === 0 ? (
              <Text style={styles.emptySearchText}>هیچ یاریزانێک نەدۆزرایەوە</Text>
            ) : (
              searchResults.map((result) => (
                <SearchResultRow
                  key={result.id}
                  result={result}
                  busy={busyId === result.id}
                  onAdd={handleAdd}
                  onSendChip={handleSearchTransfer}
                />
              ))
            )}
          </View>
        ) : null}


        {!isSearchActive && loading ? (
          <ActivityIndicator
            color="#a855f7"
            size="large"
            style={styles.loader}
          />
        ) : !isSearchActive && friends.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>هێشتا هیچ هاوڕێیەک نییە</Text>
            <Text style={styles.emptyText}>
              بە ناوی یاریزان یان ناسنامە بگەڕێ بۆ ناردنی داواکاری هاوڕێیەتی.
            </Text>
          </View>
        ) : !isSearchActive ? (
          friends.map((friend) => (
            <FriendCard
              key={friend.id}
              friend={friend}
              onSendChip={(nextFriend) => onSendChip?.(nextFriend)}
              onlineAvailable={statuses[friend.id] === "online_available"}
              inviteBusy={inviteBusyId === friend.id}
              onInvite={(nextFriend) => void handleInvite(nextFriend)}
            />
          ))
        ) : null}
      </ScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    position: "relative",
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingBottom: 18,
  },

  inlineLoader: {
    marginTop: 10,
  },

  searchRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },

  fullWidthSection: {
    width: "100%",
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },

  requestAvatar: {
    borderRadius: 21,
  },

  friendCard: {
    width: "48.8%",
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(170, 105, 255, 0.28)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "transparent",
  },

  avatarWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: "rgba(180,180,200,0.45)",
    padding: 2,
  },

  onlineAvatarWrap: {
    borderColor: "#22c55e",
    borderWidth: 3,
  },

  avatar: {
    width: "100%",
    height: "100%",
    borderRadius: 27,
  },

  info: {
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-end",
    minWidth: 0,
  },

  name: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    textAlign: "right",
    width: "100%",
  },

  playerId: {
    marginTop: 5,
    color: "#aaa7bc",
    fontSize: 12,
    fontFamily: "RobotoMedium",
    textAlign: "right",
    width: "100%",
  },

  buttonStack: {
    width: 104,
    gap: 6,
    marginRight: 12,
  },

  actionButton: {
    height: 29,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 8,
    backgroundColor: "transparent",
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

  disabledButton: {
    opacity: 0.48,
  },

  buttonText: {
    color: "#ffffff",
    fontSize: 10,
    fontFamily: "SpedaBold",
  },

  disabledButtonText: {
    color: "rgba(255,255,255,0.72)",
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
    fontSize: 18,
    fontFamily: "SpedaBold",
    marginBottom: 8,
    textAlign: "center",
  },

  emptyText: {
    color: "#9ca3af",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
    lineHeight: 19,
  },

  emptySearchText: {
    width: "100%",
    color: "#9ca3af",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
    marginTop: 14,
  },

});