import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import type { AvatarId } from '@/types/avatar';

import { DamaPiece } from './DamaPiece';
import { DAMA_TURN_DURATION_MS, type Side } from '../engine';

export type DamaPlayerView = {
  id: string;
  username: string;
  isBot?: boolean;
  avatarId?: AvatarId;
  avatarUrl?: string;
  pieceColor: Side;
  capturedCount: number;
  isCurrentTurn: boolean;
  connected?: boolean;
  botTakeover?: boolean;
};

type Props = {
  player: DamaPlayerView;
  capturedPieceColor: Side;
  width: number;
  avatarSize: number;
  turnRemainingMs: number;
};

function DamaTurnRing({ size, remainingMs }: { size: number; remainingMs: number }) {
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const remainingProgress = Math.max(0, Math.min(1, remainingMs / DAMA_TURN_DURATION_MS));
  const filledLength = circumference * remainingProgress;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={size} height={size} style={[StyleSheet.absoluteFill, { transform: [{ scaleX: -1 }] }]}>
        {filledLength > 0 && (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#facc15"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${filledLength} ${circumference}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          rotation={-90}
          originX={size / 2}
          originY={size / 2}
        />
        )}
      </Svg>
    </View>
  );
}

export function DamaPlayerSeat({ player, capturedPieceColor, width, avatarSize, turnRemainingMs }: Props) {
  const active = player.isCurrentTurn;
  const ringPadding = Math.max(3, avatarSize * 0.045);
  const capturedImageSize = Math.max(31, avatarSize * 0.43);

  return (
    <View accessibilityLabel={`${player.username}, ${player.capturedCount} pieces captured`} style={[styles.seat, { width }]}>
      <View style={[styles.infoCard, active ? styles.activeInfoCard : styles.inactiveInfoCard]}>
      <View
        style={[
          styles.avatarRing,
          active ? styles.activeRing : styles.inactiveRing,
          {
            width: avatarSize + ringPadding * 2,
            height: avatarSize + ringPadding * 2,
            borderRadius: (avatarSize + ringPadding * 2) / 2,
            padding: ringPadding,
            borderWidth: active ? 0 : 2,
          },
        ]}
      >
        <PlayerAvatar avatarId={player.isBot ? undefined : player.avatarId} avatarUrl={player.avatarUrl}
          fallbackLabel={player.isBot && !player.avatarUrl ? player.username : undefined} size={avatarSize} />
        {active && <DamaTurnRing size={avatarSize + ringPadding * 2} remainingMs={turnRemainingMs} />}
      </View>

      <Text numberOfLines={1} style={[styles.username, { fontSize: Math.max(15, Math.min(22, avatarSize * 0.24)) }]}>
        {player.username}
      </Text>
      {(player.botTakeover || player.connected === false) && <Text style={styles.connectionState}>
        {player.botTakeover ? 'کۆنترۆڵ لەلایەن بۆتەوە' : 'پەیوەندی دووبارە دەبێتەوە'}
      </Text>}

      <View style={[styles.capturedGlass, { height: Math.max(34, avatarSize * 0.42), minWidth: width * 0.62 }]}>
        <DamaPiece color={capturedPieceColor} width={capturedImageSize} height={capturedImageSize} />
        <Text style={styles.capturedCount}>× {player.capturedCount}</Text>
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  seat: { alignItems: 'center', justifyContent: 'center', direction: 'ltr' },
  infoCard: { width: '100%', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 10, borderRadius: 18, borderWidth: 1 },
  activeInfoCard: { borderColor: 'rgba(255,211,110,0.82)', backgroundColor: 'rgba(25,15,24,0.46)', shadowColor: '#ffba39', shadowOpacity: 0.35, shadowRadius: 9, shadowOffset: { width: 0, height: 0 }, elevation: 5 },
  inactiveInfoCard: { borderColor: 'rgba(189,144,235,0.62)', backgroundColor: 'rgba(17,10,26,0.48)' },
  avatarRing: { alignItems: 'center', justifyContent: 'center' },
  activeRing: { borderColor: '#ffd36e', backgroundColor: 'rgba(255,195,67,0.13)', shadowColor: '#ffba39', shadowOpacity: 0.95, shadowRadius: 15, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  inactiveRing: { borderColor: '#bd90eb', backgroundColor: 'rgba(139,83,186,0.11)', shadowColor: '#a869e9', shadowOpacity: 0.5, shadowRadius: 7, shadowOffset: { width: 0, height: 0 }, elevation: 5 },
  username: { color: '#fff7f4', fontWeight: '700', textAlign: 'center', marginTop: 7, marginBottom: 7, textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 5 },
  connectionState: { color: '#facc15', fontSize: 11, fontWeight: '700', marginTop: -5, marginBottom: 5 },
  capturedGlass: { marginTop: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(195,131,185,0.34)', backgroundColor: 'rgba(22,11,30,0.72)' },
  capturedCount: { color: '#fff2ef', fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
