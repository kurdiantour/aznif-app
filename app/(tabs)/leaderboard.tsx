import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { type AvatarId } from '@/constants/avatars';
import { getLeaderboardProfiles, useProfile } from '@/lib/profile';

type LeaderboardPlayer = {
  id: string;
  name: string;
  level: number;
  points: number;
  gold?: number;
  avatarId?: AvatarId;
};

export default function LeaderboardScreen() {
  const { profile } = useProfile();
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);

  useEffect(() => {
    let isMounted = true;

    const loadPlayers = async () => {
      try {
        const leaderboard = await getLeaderboardProfiles(50);

        if (!isMounted) return;

        setPlayers(
          leaderboard.map((player) => ({
            id: player.id,
            name: player.displayName,
            level: player.level,
            points: player.points,
            gold: player.gold ?? 0,
            avatarId: player.avatarId,
          })),
        );
      } catch (error) {
        console.warn('Failed to load leaderboard:', error);

        if (isMounted) {
          setPlayers([]);
        }
      }
    };

    void loadPlayers();

    return () => {
      isMounted = false;
    };
  }, []);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => b.points - a.points),
    [players],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.tableHeader}>
        <Text style={[styles.headerText, styles.playersHeader]}>PLAYERS</Text>
        <Text style={[styles.headerText, styles.pointsHeader]}>POINTS</Text>
        <Text style={[styles.headerText, styles.goldHeader]}>GOLD</Text>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {sortedPlayers.map((player, index) => {
          const rank = index + 1;
          const isCurrentUser = player.id === profile?.id;

          const rankLabel =
            rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;

          return (
            <View
              key={player.id}
              style={[
                styles.row,
                rank <= 3 && styles.topRow,
                isCurrentUser && styles.currentUserRow,
              ]}
            >
              <View style={styles.playerColumn}>
                <Text
                  style={[
                    styles.rankText,
                    rank <= 3 && styles.topRankText,
                    isCurrentUser && styles.currentUserText,
                  ]}
                >
                  {rankLabel}
                </Text>

                <PlayerAvatar
                  avatarId={isCurrentUser ? profile?.avatarId ?? player.avatarId : player.avatarId}
                  size={40}
                  style={[
                    styles.avatar,
                    rank <= 3 && styles.topAvatar,
                    isCurrentUser && styles.currentAvatar,
                  ]}
                />

                <View style={styles.playerInfo}>
                  <Text
                    style={[styles.playerName, isCurrentUser && styles.currentUserText]}
                    numberOfLines={1}
                  >
                    {player.name}
                    {isCurrentUser ? ' (You)' : ''}
                  </Text>

                  <Text style={styles.levelText}>Lv. {player.level}</Text>
                </View>
              </View>

              <View style={styles.pointsColumn}>
                <Text style={[styles.pointsText, isCurrentUser && styles.currentUserText]}>
                  {player.points.toLocaleString()}
                </Text>
              </View>

              <View style={styles.goldColumn}>
                <Text style={styles.goldText}>{(player.gold ?? 0).toLocaleString()}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 74,
  },

  tableHeader: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(15,23,42,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },

  headerText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
  },

  playersHeader: {
    flex: 1,
    textAlign: 'left',
  },

  pointsHeader: {
    width: 88,
    textAlign: 'right',
  },

  goldHeader: {
    width: 74,
    textAlign: 'right',
  },

  list: {
    flex: 1,
  },

  listContent: {
    gap: 8,
    paddingBottom: 16,
  },

  row: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(15,23,42,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },

  topRow: {
    backgroundColor: 'rgba(35,46,26,0.72)',
    borderColor: 'rgba(250,204,21,0.22)',
  },

  currentUserRow: {
    backgroundColor: 'rgba(80,62,18,0.82)',
    borderColor: '#facc15',
  },

  playerColumn: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },

  rankText: {
    width: 38,
    marginRight: 8,
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },

  topRankText: {
    fontSize: 18,
  },

  currentUserText: {
    color: '#facc15',
  },

  avatar: {
    marginRight: 12,
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },

  topAvatar: {
    borderColor: '#facc15',
  },

  currentAvatar: {
    borderColor: '#facc15',
    backgroundColor: 'rgba(250,204,21,0.14)',
  },

  playerInfo: {
    flex: 1,
    minWidth: 0,
  },

  playerName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },

  levelText: {
    marginTop: 3,
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '800',
  },

  pointsColumn: {
    width: 88,
    alignItems: 'flex-end',
  },

  pointsText: {
    color: '#f97316',
    fontSize: 15,
    fontWeight: '900',
  },

  goldColumn: {
    width: 74,
    alignItems: 'flex-end',
  },

  goldText: {
    color: '#d6d3d1',
    fontSize: 14,
    fontWeight: '900',
  },
});