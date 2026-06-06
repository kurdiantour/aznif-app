import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import type { AvatarId } from '@/constants/avatars';
import { useProfile } from '@/lib/profile';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Animated,
  ImageBackground,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const INTRO_DURATION_MS = 9000;

function createPracticeMatchId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

type PlayerCardProps = {
  name: string;
  rating?: string;
  filled?: boolean;
  delay?: number;
  avatarId?: AvatarId;
};

function PlayerCard({
  name,
  rating,
  filled,
  delay = 0,
  avatarId,
}: PlayerCardProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (filled) return;

    let loop: Animated.CompositeAnimation | null = null;

    const timeout = setTimeout(() => {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.04,
            duration: 750,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 750,
            useNativeDriver: true,
          }),
        ]),
      );

      loop.start();
    }, delay);

    return () => {
      clearTimeout(timeout);
      loop?.stop();
    };
  }, [delay, filled, pulse]);

  return (
    <Animated.View style={[styles.playerCard, { transform: [{ scale: pulse }] }]}>
      <LinearGradient
        colors={['rgba(57,18,105,0.92)', 'rgba(12,8,28,0.96)']}
        style={styles.playerGradient}
      >
        <View style={styles.avatarRing}>
          {filled && avatarId ? (
            <PlayerAvatar avatarId={avatarId} size={44} style={styles.avatarCircle} />
          ) : (
            <View style={[styles.avatarCircle, styles.emptyAvatar]}>
              <Text style={styles.emptyAvatarText}>?</Text>
            </View>
          )}

          {filled && <View style={styles.onlineDot} />}
        </View>

        <Text numberOfLines={1} style={styles.playerName}>
          {name}
        </Text>

        <Text style={styles.playerRating}>
          {filled ? `Rating: ${rating ?? '0'}` : 'AI Opponent'}
        </Text>
      </LinearGradient>
    </Animated.View>
  );
}

export default function PlayAIModeScreen() {
  const router = useRouter();
  const { profile } = useProfile();
  const practiceMatchIdRef = useRef(createPracticeMatchId());

  const pulse = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.04,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
    );

    const rotateLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(rotate, {
          toValue: 1,
          duration: 3800,
          useNativeDriver: true,
        }),
        Animated.timing(rotate, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    pulseLoop.start();
    rotateLoop.start();

    const timeout = setTimeout(() => {
      router.replace({
        pathname: '/game',
        params: {
          room_id: practiceMatchIdRef.current,
          mode: '1v1',
          practice: 'true',
        },
      });
    }, INTRO_DURATION_MS);

    return () => {
      clearTimeout(timeout);
      pulseLoop.stop();
      rotateLoop.stop();
    };
  }, [pulse, rotate, router]);

  const spin = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const playerName = profile?.displayName ?? profile?.username ?? 'Player';
  const playerRating = String(profile?.points ?? 0);
  const playerAvatarId = profile?.avatarId as AvatarId | undefined;

  return (
    <ImageBackground
      source={require('@/assets/images/lobby/lobby-bg.webp')}
      style={styles.background}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.overlay} />

        <View style={styles.matchArea}>
          <View style={styles.sidePlayers}>
            <PlayerCard
              name={playerName}
              rating={playerRating}
              filled
              avatarId={playerAvatarId}
            />
          </View>

          <View style={styles.centerColumn}>
            <View style={styles.centerWrap}>
              <Animated.View style={[styles.outerRing, { transform: [{ rotate: spin }] }]}>
                <View style={styles.ringGlow} />
              </Animated.View>

              <Animated.View style={[styles.centerCircle, { transform: [{ scale: pulse }] }]}>
                <Text style={styles.matchText}>VS</Text>
                <Text style={styles.waitText}>AI Opponent</Text>
              </Animated.View>
            </View>
          </View>

          <View style={styles.sidePlayers}>
            <PlayerCard
              name="AI Bot"
              rating="Practice"
              filled
              avatarId="bot-avatar"
            />
          </View>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: '#050214',
  },

  safeArea: {
    flex: 1,
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3,0,15,0.54)',
  },

  matchArea: {
    flex: 1,
    paddingHorizontal: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 34,
  },

  sidePlayers: {
    flexDirection: 'row',
    gap: 16,
  },

  playerCard: {
    width: 106,
    height: 152,
    borderRadius: 15,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#a855f7',
    backgroundColor: 'rgba(17,7,35,0.88)',
  },

  playerGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 9,
  },

  avatarRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    borderColor: '#a855f7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
  },

  avatarCircle: {
    width: 51,
    height: 51,
    borderRadius: 26,
    backgroundColor: '#f8d17b',
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyAvatar: {
    backgroundColor: 'rgba(0,0,0,0.42)',
  },

  emptyAvatarText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
  },

  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 6,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#22c55e',
  },

  playerName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 5,
    maxWidth: 88,
  },

  playerRating: {
    color: '#d7c9ef',
    fontSize: 10,
    fontWeight: '700',
  },

  centerColumn: {
    width: 185,
    alignItems: 'center',
    justifyContent: 'center',
  },

  centerWrap: {
    width: 170,
    height: 170,
    alignItems: 'center',
    justifyContent: 'center',
  },

  outerRing: {
    position: 'absolute',
    width: 164,
    height: 164,
    borderRadius: 82,
    borderWidth: 3,
    borderColor: 'rgba(168,85,247,0.55)',
    borderTopColor: '#e9d5ff',
    borderRightColor: '#7c3aed',
  },

  ringGlow: {
    position: 'absolute',
    top: -4,
    left: 70,
    width: 24,
    height: 8,
    borderRadius: 99,
    backgroundColor: '#c084fc',
  },

  centerCircle: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: 'rgba(12,5,35,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(216,180,254,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  matchText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
  },

  waitText: {
    color: '#d7c9ef',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 6,
  },
});
