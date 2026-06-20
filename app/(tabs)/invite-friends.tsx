import { FriendsPanel } from '@/components/friends/friends-panel';
import { RequestsPanel } from '@/components/friends/requests-panel';
import { TransfersPanel } from '@/components/friends/transfers-panel';
import { getFriendRequests } from '@/lib/friends';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/supabaseAuth';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type TabKey = 'friends' | 'requests' | 'transfers';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'friends', label: 'FRIENDS' },
  { key: 'requests', label: 'REQUESTS' },
  { key: 'transfers', label: 'TRANSFERS' },
];

export default function InviteFriendsScreen() {
  const [activeTab, setActiveTab] = useState<TabKey>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [requestCount, setRequestCount] = useState(0);

  const refreshRequestCount = useCallback(async () => {
    const requests = await getFriendRequests();
    setRequestCount(requests.length);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshRequestCount();
    }, [refreshRequestCount])
  );

  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    getCurrentUser().then((user) => {
      if (!mounted || !user) return;

      channel = supabase
        .channel(`friend-request-count:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'friendships',
            filter: `addressee_id=eq.${user.id}`,
          },
          () => {
            void refreshRequestCount();
          }
        )
        .subscribe();
    });

    return () => {
      mounted = false;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [refreshRequestCount]);

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <View style={styles.sidebar}>
          <View style={styles.searchBox}>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Username or Player ID..."
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
                style={[styles.sidebarItem, isActive && styles.sidebarItemActive]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Text
                  style={[styles.sidebarText, isActive && styles.sidebarTextActive]}
                >
                  {tab.label}
                </Text>
                {tab.key === 'requests' && requestCount > 0 ? (
                  <View style={styles.requestBadge} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.content}>
          {activeTab === 'friends' ? (
            <FriendsPanel searchQuery={searchQuery} />
          ) : activeTab === 'requests' ? (
            <RequestsPanel onRequestsChanged={setRequestCount} />
          ) : (
            <TransfersPanel />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  body: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    paddingTop: 0,
    paddingBottom: 82,
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
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },

  searchInput: {
    color: '#ffffff',
    fontSize: 11,
    fontFamily: 'SpedaBold',
    padding: 0,
  },

  sidebarItem: {
    height: 36,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },

  sidebarItemActive: {
    borderColor: 'rgba(255, 184, 64, 0.85)',
    backgroundColor: 'rgba(28, 17, 52, 0.35)',
  },

  sidebarText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontFamily: 'SpedaBold',
  },

  sidebarTextActive: {
    color: '#ffffff',
  },

  requestBadge: {
    position: 'absolute',
    top: 8,
    right: 10,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },

  content: {
    flex: 1,
  },
});
