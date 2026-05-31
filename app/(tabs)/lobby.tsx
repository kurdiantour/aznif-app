import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    Image,
    Pressable,
    StyleSheet,
    Text,
    View,
    type ImageSourcePropType,
} from 'react-native';

import { supabase } from '@/lib/supabase';

type GameMode = '1v1' | '2v2';
type MatchType = 'duo' | 'squad';

type ModeCardProps = {
  title: string;
  subtitle: string;
  playersOnline?: boolean;
  image?: ImageSourcePropType;
  imageOnly?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

function ModeCard({
  title,
  subtitle,
  playersOnline,
  image,
  imageOnly,
  disabled,
  onPress,
}: ModeCardProps) {
  return (
    <Pressable
      style={[styles.card, disabled && styles.cardDisabled]}
      onPress={disabled ? undefined : onPress}
    >
      {image ? (
        <Image source={image} style={styles.cardImageInner} resizeMode="cover" />
      ) : (
        <LinearGradient
          colors={['#1d1145', '#3b1676', '#090b1d']}
          style={styles.cardImage}
        />
      )}

      {playersOnline && (
        <View style={styles.playersBadge}>
          <View style={styles.onlineDot} />
          <Text style={styles.playersText}>Players Online</Text>
        </View>
      )}

      {!imageOnly && (
        <>
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.92)']}
            style={styles.bottomFade}
          />

          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardSubtitle}>{subtitle}</Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

export default function LobbyScreen() {
  const router = useRouter();
  const [isSearching, setIsSearching] = useState(false);

  const startPublicMatch = async (mode: GameMode, matchType: MatchType) => {
    if (isSearching) return;

    setIsSearching(true);

    try {
      const { data: result, error } =
        mode === '1v1'
          ? await supabase.rpc('find_one_vs_one_opponent')
          : await supabase.rpc('find_two_vs_two_match');

      if (error) {
        throw error;
      }

      if (!result) {
        throw new Error('Failed to start matchmaking.');
      }

      // Navigate to matchmaking screen - both immediate match and "searching" states
      router.push({
        pathname: '/matchmaking',
        params: {
          mode,
          matchmaking_status: result.status, // 'matched' or 'searching'
          room_id: result.room_id, // Present if 'matched', undefined if 'searching'
          matchType,
        },
      });
    } catch (error) {
      console.warn('Unable to start matchmaking', error);
      setIsSearching(false);
    }
  };

  return (
    <View style={styles.content}>
      <View style={styles.leftCards}>
        <ModeCard
          playersOnline
          title="1 vs 1"
          subtitle="Real player match"
          image={require('@/assets/images/mode-select/1vs1.webp')}
          disabled={isSearching}
          onPress={() => startPublicMatch('1v1', 'duo')}
        />

        <ModeCard
          title="2 vs 2"
          subtitle="Real 4-player match"
          image={require('@/assets/images/mode-select/2vs2.webp')}
          disabled={isSearching}
          onPress={() => startPublicMatch('2v2', 'squad')}
        />

        <ModeCard
          title="Tournament"
          subtitle="Join special events"
          image={require('@/assets/images/lobby/tournament-bg.webp')}
          disabled={isSearching}
        />
      </View>

      <View style={styles.rightCards}>
        <ModeCard
          title="Play with AI"
          subtitle="Practice offline"
          image={require('@/assets/images/lobby/play-ai-bg.webp')}
          disabled={isSearching}
          onPress={() =>
            router.push({
              pathname: '/game',
              params: {
                mode: '1v1',
                practice: 'true',
                matchType: 'bot',
              },
            })
          }
        />

        <ModeCard
          title="Create Room"
          subtitle="Host a table"
          image={require('@/assets/images/lobby/create-room.webp')}
          disabled={isSearching}
          onPress={() =>
            router.push({
              pathname: '/create-room',
              params: {
                matchType: 'private',
              },
            })
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexDirection: 'row',
    alignSelf: 'center',
    width: '100%',
    height: '80%',
    maxHeight: 238,
    minHeight: 205,
    gap: 8,
    marginTop: 0,
  },

  leftCards: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },

  rightCards: {
    width: '26%',
    gap: 8,
  },

  card: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1.2,
    borderColor: 'rgba(180,120,255,0.42)',
    backgroundColor: 'rgba(17,24,39,0.82)',
  },

  cardDisabled: {
    opacity: 0.65,
  },

  cardImage: {
    width: '100%',
    height: '100%',
  },

  cardImageInner: {
    width: '100%',
    height: '100%',
  },

  playersBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },

  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: '#22c55e',
    marginRight: 7,
  },

  playersText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },

  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 86,
  },

  cardInfo: {
    position: 'absolute',
    left: 15,
    right: 15,
    bottom: 12,
  },

  cardTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },

  cardSubtitle: {
    marginTop: 2,
    color: '#f3f4f6',
    fontSize: 10,
    fontWeight: '800',
  },
});
