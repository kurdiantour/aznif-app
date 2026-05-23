import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { ProfileDrawer } from '@/components/profile/ProfileDrawer';
import { SettingsDrawer } from '@/components/settings/SettingsDrawer';
import { useProfile } from '@/lib/profile';
import { getBalance } from '@/lib/wallet';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function LobbyHeader() {
  const { profile, loading } = useProfile();

  const [mcBalance, setMcBalance] = useState<string>('...');
  const [goldBalance, setGoldBalance] = useState<string>('...');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadBalance() {
      if (loading || !profile?.id) {
        return;
      }

      try {
        const wallet = await getBalance();

        if (isMounted) {
          setMcBalance(Number(wallet.balances.mc || 0).toFixed(0));
          setGoldBalance(Number(wallet.balances.gold || 0).toFixed(0));
        }
      } catch (error) {
        console.log('[LobbyHeader] Failed to load wallet balance:', error);

        if (isMounted) {
          setMcBalance('0');
          setGoldBalance('0');
        }
      }
    }

    loadBalance();

    return () => {
      isMounted = false;
    };
  }, [loading, profile?.id]);

  return (
    <>
      <View>
        <View style={styles.topBar}>
          <Pressable style={styles.userBox} onPress={() => setIsProfileOpen(true)}>
            <PlayerAvatar avatarId={profile?.avatarId} size={50} style={styles.avatar} />

            <View>
              <Text style={styles.username} numberOfLines={1}>
                {profile?.displayName ?? 'Player'}
              </Text>

              <Text style={styles.level}>Lv. {profile?.level ?? 1}</Text>
            </View>
          </Pressable>

          <View style={styles.topRight}>
            <View style={styles.balanceGroup}>
              <View style={styles.balancePill}>
                <Text style={styles.balanceText}>{mcBalance} MC</Text>
              </View>

              <View style={styles.balancePillSecondary}>
                <Text style={styles.balanceText}>{goldBalance} Gold</Text>
              </View>
            </View>

            <Pressable
              style={styles.topIcon}
              onPress={() => setIsSettingsOpen(true)}
            >
              <Text style={styles.topIconText}>⚙️</Text>
            </Pressable>
          </View>
        </View>

        <LinearGradient
          colors={[
            'rgba(168,85,247,0)',
            'rgba(168,85,247,0.75)',
            'rgba(20,241,193,0.55)',
            'rgba(168,85,247,0)',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.headerGradientLine}
        />
      </View>

      <ProfileDrawer
        visible={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />

      <SettingsDrawer
        visible={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  topBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  userBox: {
    width: 165,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  avatar: {
    width: 50,
    height: 50,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },

  username: {
    maxWidth: 105,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },

  level: {
    marginTop: 1,
    color: '#8fa4d3',
    fontSize: 9,
    fontWeight: '800',
  },

  topRight: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },

  balanceGroup: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },

  balancePill: {
    height: 36,
    minWidth: 92,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  balancePillSecondary: {
    height: 36,
    minWidth: 92,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  balanceText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
  },

  topIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  topIconText: {
    fontSize: 16,
  },

  headerGradientLine: {
    height: 1,
    marginTop: 10,
    marginBottom: 14,
    borderRadius: 999,
    opacity: 0.95,
  },
});