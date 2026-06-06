import { Slot } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomNav } from '@/components/lobby/BottomNav';
import { LobbyHeader } from '@/components/lobby/LobbyHeader';

export default function TabsLayout() {
  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState(false);

  return (
    <View style={styles.container}>
      <LobbyHeader onProfileDrawerVisibilityChange={setIsProfileDrawerOpen} />

      <View style={styles.content}>
        <Slot />
      </View>

      {!isProfileDrawerOpen ? <BottomNav /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 36,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: '#090b1d',
  },

  content: {
    flex: 1,
  },
});
