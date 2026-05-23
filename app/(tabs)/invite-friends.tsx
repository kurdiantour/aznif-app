import { FriendsPanel } from '@/components/friends/friends-panel';
import { TransfersPanel } from '@/components/friends/transfers-panel';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type TabKey = 'friends' | 'transfers';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'friends', label: 'FRIENDS' },
  { key: 'transfers', label: 'TRANSFERS' },
];

export default function InviteFriendsScreen() {
  const [activeTab, setActiveTab] = useState<TabKey>('friends');

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <View style={styles.sidebar}>
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
              </Pressable>
            );
          })}
        </View>

        <View style={styles.content}>
          {activeTab === 'friends' ? <FriendsPanel /> : <TransfersPanel />}
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
    paddingTop: 22,
    paddingBottom: 82,
  },

  sidebar: {
    width: 170,
    gap: 10,
    paddingTop: 2,
  },

  sidebarItem: {
    height: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sidebarItemActive: {
    borderColor: 'rgba(255, 184, 64, 0.85)',
    backgroundColor: 'rgba(28, 17, 52, 0.35)',
  },

  sidebarText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '900',
  },

  sidebarTextActive: {
    color: '#ffffff',
  },

  content: {
    flex: 1,
  },
});