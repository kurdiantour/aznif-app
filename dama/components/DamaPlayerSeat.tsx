import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { PlayerAvatar } from '@/components/player/PlayerAvatar';

import { DamaPiece } from './DamaPiece';
import type { DamaPlayerView } from '../mock-players';
import type { DamaPieceColor } from '../mock-position';

type Props = {
  player: DamaPlayerView;
  capturedPieceColor: DamaPieceColor;
  width: number;
  avatarSize: number;
};

function formatTimer(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function DamaPlayerSeat({ player, capturedPieceColor, width, avatarSize }: Props) {
  const active = player.isCurrentTurn;
  const ringPadding = Math.max(3, avatarSize * 0.045);
  const capturedImageSize = Math.max(31, avatarSize * 0.43);

  return (
    <View accessibilityLabel={`${player.username}, ${formatTimer(player.secondsRemaining)}, ${player.capturedCount} pieces captured`} style={[styles.seat, { width }]}>
      <View
        style={[
          styles.avatarRing,
          active ? styles.activeRing : styles.inactiveRing,
          {
            width: avatarSize + ringPadding * 2,
            height: avatarSize + ringPadding * 2,
            borderRadius: (avatarSize + ringPadding * 2) / 2,
            padding: ringPadding,
            borderWidth: active ? 3 : 2,
          },
        ]}
      >
        <PlayerAvatar avatarId={player.avatarId} avatarUrl={player.avatarUrl} size={avatarSize} />
      </View>

      <Text numberOfLines={1} style={[styles.username, { fontSize: Math.max(15, Math.min(22, avatarSize * 0.24)) }]}>
        {player.username}
      </Text>

      <View style={[styles.timerGlass, active && styles.activeGlass, { width: width * 0.92, height: Math.max(36, avatarSize * 0.46) }]}>
        <Ionicons name="time-outline" size={Math.max(18, avatarSize * 0.24)} color={active ? '#f8c85f' : '#c7b8d5'} />
        <Text style={[styles.timerText, active && styles.activeTimerText, { fontSize: Math.max(17, Math.min(27, avatarSize * 0.29)) }]}>
          {formatTimer(player.secondsRemaining)}
        </Text>
      </View>

      <View style={[styles.capturedGlass, { height: Math.max(34, avatarSize * 0.42), minWidth: width * 0.62 }]}>
        <DamaPiece color={capturedPieceColor} width={capturedImageSize} height={capturedImageSize} />
        <Text style={styles.capturedCount}>× {player.capturedCount}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  seat: { alignItems: 'center', justifyContent: 'center', direction: 'ltr' },
  avatarRing: { alignItems: 'center', justifyContent: 'center' },
  activeRing: { borderColor: '#ffd36e', backgroundColor: 'rgba(255,195,67,0.13)', shadowColor: '#ffba39', shadowOpacity: 0.95, shadowRadius: 15, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  inactiveRing: { borderColor: '#bd90eb', backgroundColor: 'rgba(139,83,186,0.11)', shadowColor: '#a869e9', shadowOpacity: 0.5, shadowRadius: 7, shadowOffset: { width: 0, height: 0 }, elevation: 5 },
  username: { color: '#fff7f4', fontWeight: '700', textAlign: 'center', marginTop: 7, marginBottom: 7, textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 5 },
  timerGlass: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(193,145,209,0.36)', backgroundColor: 'rgba(17,10,26,0.73)' },
  activeGlass: { borderColor: 'rgba(255,198,79,0.85)', backgroundColor: 'rgba(24,14,19,0.78)' },
  timerText: { color: '#d6c7df', fontWeight: '700', fontVariant: ['tabular-nums'] },
  activeTimerText: { color: '#ffd170' },
  capturedGlass: { marginTop: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(195,131,185,0.34)', backgroundColor: 'rgba(22,11,30,0.72)' },
  capturedCount: { color: '#fff2ef', fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
