import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { supabase } from '@/lib/supabase';
import { rtlStyles } from '@/lib/rtl';

type GameMode = '1v1' | '2v2';
type MatchType = 'duo' | 'squad';

type ModeCardProps = {
  title?: string;
  subtitle: string;
  playersOnline?: boolean;
  image?: ImageSourcePropType;
  imageOnly?: boolean;
  disabled?: boolean;
  badge?: string;
  isTablet?: boolean;
  onPress?: () => void;
};

function ModeCard({
  title,
  subtitle,
  playersOnline,
  image,
  imageOnly,
  disabled,
  badge,
  isTablet,
  onPress,
}: ModeCardProps) {
  return (
    <Pressable
      style={[styles.card, isTablet && styles.cardTablet, disabled && styles.cardDisabled]}
      onPress={disabled ? undefined : onPress}
    >
      {image ? (
        <Image
          source={image}
          style={styles.cardImageInner}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : (
        <LinearGradient
          colors={['#1d1145', '#3b1676', '#090b1d']}
          style={styles.cardImage}
        />
      )}

      {playersOnline && (
        <View style={[styles.playersBadge, isTablet && styles.playersBadgeTablet]}>
          <View style={[styles.onlineDot, isTablet && styles.onlineDotTablet]} />
          <Text style={[styles.playersText, isTablet && styles.playersTextTablet]}>
            یاریزان لەسەر هێڵە
          </Text>
        </View>
      )}

      {badge ? (
        <View style={[styles.comingSoonBadge, isTablet && styles.comingSoonBadgeTablet]}>
          <Text style={[styles.comingSoonText, isTablet && styles.comingSoonTextTablet]}>
            {badge}
          </Text>
        </View>
      ) : null}

      {!imageOnly && (
        <>
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.92)']}
            style={[styles.bottomFade, isTablet && styles.bottomFadeTablet]}
          />

          <View style={[styles.cardInfo, isTablet && styles.cardInfoTablet]}>
            {title ? (
              <Text style={[styles.cardTitle, isTablet && styles.cardTitleTablet]}>
                {title}
              </Text>
            ) : null}

            <Text style={[styles.cardSubtitle, isTablet && styles.cardSubtitleTablet]}>
              {subtitle}
            </Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

export default function LobbyScreen() {
  const router = useRouter();
  const [isSearching, setIsSearching] = useState(false);
  const { width, height } = useWindowDimensions();

  const shortestSide = Math.min(width, height);
  const isTablet = shortestSide >= 600;

  const startPublicMatch = async (mode: GameMode, matchType: MatchType) => {
    if (isSearching) return;

    setIsSearching(true);

    try {
      const { data: result, error } =
        mode === '1v1'
          ? await supabase.rpc('find_one_vs_one_opponent')
          : await supabase.rpc('find_two_vs_two_match');

      if (error) throw error;
      if (!result) throw new Error('نەتوانرا گەڕان بۆ یاری دەست پێ بکات.');

      router.push({
        pathname: '/matchmaking',
        params: {
          mode,
          matchmaking_status: result.status,
          room_id: result.room_id,
          matchType,
        },
      });
    } catch (error) {
      console.warn('Unable to start matchmaking', error);
      setIsSearching(false);
    }
  };

  return (
    <View style={[styles.content, rtlStyles.row, isTablet && styles.contentTablet]}>
      <View style={[styles.leftCards, rtlStyles.row, isTablet && styles.leftCardsTablet]}>
        <ModeCard
          isTablet={isTablet}
          playersOnline
          title="پێکدادان"
          subtitle="توانای خۆت بسەلمێنە"
          image={require('@/assets/images/mode-select/1vs1.webp')}
          disabled={isSearching}
          onPress={() => startPublicMatch('1v1', 'duo')}
        />

        <ModeCard
          isTablet={isTablet}
          title="هاوپەیمان"
          subtitle="یاری (4) یاریزانی ڕاستەقینە"
          image={require('@/assets/images/mode-select/2vs2.webp')}
          disabled={isSearching}
          onPress={() => startPublicMatch('2v2', 'squad')}
        />

        <ModeCard
          isTablet={isTablet}
          title="پاڵەوانیەتی"
          subtitle="تاجی سەرکەوتن چاوەڕێتە"
          badge="بەم زووانە"
          image={require('@/assets/images/lobby/tournament-bg.webp')}
          disabled
        />
      </View>

      <View style={[styles.rightCards, isTablet && styles.rightCardsTablet]}>
        <ModeCard
          isTablet={isTablet}
          subtitle="یاریکردن لەگەڵ رۆبۆت"
          image={require('@/assets/images/lobby/play-ai-bg.webp')}
          disabled={isSearching}
          onPress={() => router.push('/play-ai')}
        />

        <ModeCard
          isTablet={isTablet}
          subtitle="یارییەکی تایبەت دروست بکە"
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
    alignSelf: 'center',
    width: '100%',
    height: '80%',
    maxHeight: 238,
    minHeight: 205,
    gap: 8,
    marginTop: 0,
  },

  contentTablet: {
    width: '100%',
    height: '72%',
    maxHeight: 520,
    minHeight: 390,
    gap: 18,
    marginTop: 12,
  },

  leftCards: {
    flex: 1,
    gap: 8,
  },

  leftCardsTablet: {
    gap: 18,
  },

  rightCards: {
    width: '26%',
    gap: 8,
  },

  rightCardsTablet: {
    width: '28%',
    gap: 18,
  },

  card: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1.2,
    borderColor: 'rgba(180,120,255,0.42)',
    backgroundColor: 'rgba(17,24,39,0.82)',
  },

  cardTablet: {
    borderRadius: 18,
    borderWidth: 1.4,
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

  playersBadgeTablet: {
    top: 18,
    left: 18,
  },

  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: '#22c55e',
    marginRight: 7,
  },

  onlineDotTablet: {
    width: 10,
    height: 10,
    marginRight: 9,
  },

  playersText: {
    color: '#ffffff',
    fontSize: 11,
    fontFamily: 'SpedaBold',
  },

  playersTextTablet: {
    fontSize: 14,
  },

  comingSoonBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(88, 28, 135, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(233, 213, 255, 0.55)',
  },

  comingSoonBadgeTablet: {
    top: 16,
    right: 16,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },

  comingSoonText: {
    color: '#f3e8ff',
    fontSize: 8,
    fontFamily: 'SpedaBold',
  },

  comingSoonTextTablet: {
    fontSize: 11,
  },

  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 86,
  },

  bottomFadeTablet: {
    height: 125,
  },

  cardInfo: {
    position: 'absolute',
    left: 15,
    right: 15,
    bottom: 12,
    alignItems: 'center',
  },

  cardInfoTablet: {
    left: 20,
    right: 20,
    bottom: 18,
  },

  cardTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },

  cardTitleTablet: {
    fontSize: 24,
  },

  cardSubtitle: {
    marginTop: 5,
    color: '#f3f4f6',
    fontSize: 11,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },

  cardSubtitleTablet: {
    marginTop: 8,
    fontSize: 16,
  },
});
