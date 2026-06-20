import {
  getFriends,
  searchFriendCandidates,
  sendFriendRequest,
  type Friend,
  type FriendSearchResult,
} from '@/lib/friends';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { SendChipPopup } from './send-chip-popup';

function FriendCard({
  friend,
  onSendChip,
}: {
  friend: Friend;
  onSendChip: (friend: Friend) => void;
}) {
  return (
    <View style={styles.friendCard}>
      <View style={styles.avatarWrap}>
        <PlayerAvatar avatarId={friend.avatarId} size={58} style={styles.avatar} />
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {friend.name}
        </Text>

        <Text style={styles.playerId} numberOfLines={1}>
          ID: {friend.playerId}
        </Text>
      </View>

      <View style={styles.buttonStack}>
        <Pressable style={styles.actionButton} onPress={() => onSendChip(friend)}>
          <Text style={styles.buttonText}>SEND CHIP</Text>
        </Pressable>

        <Pressable style={[styles.actionButton, styles.disabledButton]} disabled>
          <Text style={[styles.buttonText, styles.disabledButtonText]}>INVITE</Text>
        </Pressable>
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
  const isFriend = result.friendshipStatus === 'accepted';
  const isPending = result.friendshipStatus === 'pending';
  const label = isFriend
    ? 'FRIENDS'
    : isPending && result.friendshipDirection === 'incoming'
      ? 'PENDING'
      : isPending
        ? 'SENT'
        : 'ADD';

  return (
    <View style={styles.searchRow}>
      <PlayerAvatar avatarId={result.avatarId} size={38} style={styles.requestAvatar} />

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {result.name}
        </Text>
        <Text style={styles.playerId} numberOfLines={1}>
          ID: {result.playerId}
        </Text>
      </View>

      <Pressable
        style={[
          styles.smallButton,
          !isFriend && !isPending && styles.acceptButton,
          (isFriend || isPending) && styles.disabledButton,
        ]}
        disabled={busy || isFriend || isPending}
        onPress={() => (isFriend ? onSendChip(result) : onAdd(result))}
      >
        <Text style={[styles.buttonText, (isFriend || isPending) && styles.disabledButtonText]}>
          {isFriend ? 'SEND CHIP' : label}
        </Text>
      </Pressable>
    </View>
  );
}

type FriendsPanelProps = {
  searchQuery?: string;
};

export function FriendsPanel({ searchQuery = '' }: FriendsPanelProps) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [searchResults, setSearchResults] = useState<FriendSearchResult[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const nextFriends = await getFriends();
    setFriends(nextFriends);
  }, []);

  useEffect(() => {
    let mounted = true;

    setLoading(true);
    refresh()
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Unable to load friends.');
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
    }, [refresh])
  );

  useEffect(() => {
    let mounted = true;
    const handle = setTimeout(() => {
      const trimmed = searchQuery.trim();

      if (trimmed.length < 2) {
        setSearchResults([]);
        setSearching(false);
        return;
      }

      setSearching(true);
      searchFriendCandidates(trimmed)
        .then((results) => {
          if (mounted) setSearchResults(results);
        })
        .catch((err) => {
          if (mounted) setError(err instanceof Error ? err.message : 'Search failed.');
        })
        .finally(() => {
          if (mounted) setSearching(false);
        });
    }, 300);

    return () => {
      mounted = false;
      clearTimeout(handle);
    };
  }, [searchQuery]);

  async function handleAdd(result: FriendSearchResult) {
    setBusyId(result.id);
    setError(null);
    setSuccessMessage(null);

    try {
      await sendFriendRequest(result.id);
      setSearchResults((current) =>
        current.map((item) =>
          item.id === result.id
            ? { ...item, friendshipStatus: 'pending', friendshipDirection: 'outgoing' }
            : item
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send friend request.');
    } finally {
      setBusyId(null);
    }
  }

  function handleSearchTransfer(result: FriendSearchResult) {
    setSelectedFriend({
      id: result.id,
      name: result.name,
      playerId: result.playerId,
      avatarId: result.avatarId,
      friendshipId: '',
    });
  }

  function handleTransferSuccess() {
    setSuccessMessage('MC sent successfully.');
    void refresh();
  }

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {searching || searchResults.length > 0 ? (
          <View style={styles.fullWidthSection}>
            {searching ? <ActivityIndicator color="#a855f7" style={styles.inlineLoader} /> : null}

            {searchResults.map((result) => (
              <SearchResultRow
                key={result.id}
                result={result}
                busy={busyId === result.id}
                onAdd={handleAdd}
                onSendChip={handleSearchTransfer}
              />
            ))}
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}

        {loading ? (
          <ActivityIndicator color="#a855f7" size="large" style={styles.loader} />
        ) : friends.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No friends yet</Text>
            <Text style={styles.emptyText}>
              Search by username or player ID to send a friend request.
            </Text>
          </View>
        ) : (
          friends.map((friend) => (
            <FriendCard key={friend.id} friend={friend} onSendChip={setSelectedFriend} />
          ))
        )}
      </ScrollView>

      <SendChipPopup
        friend={selectedFriend}
        visible={!!selectedFriend}
        onClose={() => setSelectedFriend(null)}
        onTransferSuccess={handleTransferSuccess}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 18,
  },

  inlineLoader: {
    marginTop: 10,
  },

  searchRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },

  fullWidthSection: {
    width: '100%',
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },

  requestAvatar: {
    borderRadius: 21,
  },

  friendCard: {
    width: '48.8%',
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(170, 105, 255, 0.28)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'transparent',
  },

  avatarWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: 'rgba(180,180,200,0.45)',
    padding: 2,
  },

  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 27,
  },

  info: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },

  name: {
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'SpedaBold',
  },

  playerId: {
    marginTop: 5,
    color: '#aaa7bc',
    fontSize: 12,
    fontFamily: 'SpedaBold',
  },

  buttonStack: {
    width: 104,
    gap: 6,
    marginLeft: 12,
  },

  actionButton: {
    height: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 8,
    backgroundColor: 'transparent',
  },

  smallButton: {
    minWidth: 68,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 8,
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
  },

  acceptButton: {
    borderColor: 'rgba(34,197,94,0.55)',
    backgroundColor: 'rgba(34,197,94,0.16)',
  },

  disabledButton: {
    opacity: 0.48,
  },

  buttonText: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: 'SpedaBold',
  },

  disabledButtonText: {
    color: 'rgba(255,255,255,0.72)',
  },

  loader: {
    width: '100%',
    marginTop: 40,
  },

  emptyBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },

  emptyTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontFamily: 'SpedaBold',
    marginBottom: 8,
    textAlign: 'center',
  },

  emptyText: {
    color: '#9ca3af',
    fontSize: 13,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
    lineHeight: 19,
  },

  errorText: {
    width: '100%',
    color: '#ff8a8a',
    fontSize: 12,
    fontFamily: 'SpedaBold',
  },

  successText: {
    width: '100%',
    color: '#7dd3fc',
    fontSize: 12,
    fontFamily: 'SpedaBold',
  },
});
