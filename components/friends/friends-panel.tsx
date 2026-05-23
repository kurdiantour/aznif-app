import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import type { AvatarId } from '@/constants/avatars';
import { SendChipPopup } from './send-chip-popup';

export type Friend = {
  id: string;
  name: string;
  avatarId: AvatarId;
  online: boolean;
};

const friends: Friend[] = [
  {
    id: '48273195',
    name: 'ArminDomino',
    avatarId: 'avatar-1',
    online: true,
  },
  {
    id: '77192410',
    name: 'NedaDomino',
    avatarId: 'avatar-2',
    online: true,
  },
  {
    id: '19458273',
    name: 'MatinPro',
    avatarId: 'avatar-3',
    online: true,
  },
  {
    id: '63829147',
    name: 'DanielKing',
    avatarId: 'avatar-4',
    online: false,
  },
  {
    id: '90517462',
    name: 'SinaDomino',
    avatarId: 'avatar-1',
    online: false,
  },
  {
    id: '31764028',
    name: 'MinaPlay',
    avatarId: 'avatar-2',
    online: false,
  },
];

function FriendCard({
  friend,
  onSendChip,
}: {
  friend: Friend;
  onSendChip: (friend: Friend) => void;
}) {
  return (
    <View style={styles.friendCard}>
      <View
        style={[
          styles.avatarWrap,
          {
            borderColor: friend.online ? '#1c7514' : 'rgba(180,180,200,0.45)',
          },
        ]}
      >
        <PlayerAvatar avatarId={friend.avatarId} size={58} style={styles.avatar} />

        <View
          style={[
            styles.avatarStatusDot,
            {
              backgroundColor: friend.online ? '#1c7514' : '#aaa7bc',
            },
          ]}
        />
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {friend.name}
        </Text>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: friend.online ? '#24961a' : '#aaa7bc',
              },
            ]}
          />

          <Text
            style={[
              styles.statusText,
              {
                color: friend.online ? '#24961a' : '#aaa7bc',
              },
            ]}
          >
            {friend.online ? 'Online' : 'Offline'}
          </Text>
        </View>
      </View>

      <View style={styles.buttonStack}>
        <Pressable style={styles.actionButton} onPress={() => onSendChip(friend)}>
          <Text style={styles.buttonText}>SEND CHIP</Text>
        </Pressable>

        <Pressable style={styles.actionButton}>
          <Text style={styles.buttonText}>INVITE</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function FriendsPanel() {
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {friends.map((friend) => (
          <FriendCard
            key={friend.id}
            friend={friend}
            onSendChip={setSelectedFriend}
          />
        ))}
      </ScrollView>

      <SendChipPopup
        friend={selectedFriend}
        visible={!!selectedFriend}
        onClose={() => setSelectedFriend(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },

  scrollContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 18,
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
    padding: 2,
    position: 'relative',
  },

  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 27,
  },

  avatarStatusDot: {
    position: 'absolute',
    right: 1,
    bottom: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#05020b',
  },

  info: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },

  name: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },

  statusRow: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },

  statusText: {
    fontSize: 12,
    fontWeight: '800',
  },

  buttonStack: {
    width: 104,
    gap: 6,
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

  buttonText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
});