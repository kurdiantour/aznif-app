import { AVATAR_IDS, type AvatarId } from '@/constants/avatars';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PlayerAvatar } from './PlayerAvatar';

type AvatarPickerModalProps = {
  visible: boolean;
  selectedAvatarId?: AvatarId;
  onSelect: (avatarId: AvatarId) => void;
  onClose: () => void;
};

export function AvatarPickerModal({
  visible,
  selectedAvatarId,
  onSelect,
  onClose,
}: AvatarPickerModalProps) {
  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={styles.card}>
        <Text style={styles.title}>Choose Avatar</Text>
        <Text style={styles.subtitle}>Select your profile look</Text>

        <View style={styles.options}>
          {AVATAR_IDS.map((avatarId) => {
            const active = selectedAvatarId === avatarId;

            return (
              <Pressable
                key={avatarId}
                style={[styles.option, active && styles.optionSelected]}
                onPress={() => onSelect(avatarId)}
              >
                <PlayerAvatar avatarId={avatarId} size={64} />
              </Pressable>
            );
          })}
        </View>

        <Pressable style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1001,
    elevation: 1001,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },

  card: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.55)',
    backgroundColor: '#0b0718',
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 20,
    alignItems: 'center',
  },

  title: {
    color: '#ffffff',
    fontSize: 20,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },

  subtitle: {
    marginTop: 4,
    color: '#9ca3ff',
    fontSize: 13,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },

  options: {
    width: 388,
    maxWidth: '100%',
    marginTop: 22,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14,
  },

  option: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  optionSelected: {
    borderWidth: 2,
    borderColor: '#14f1c1',
    backgroundColor: 'rgba(20, 241, 193, 0.14)',
  },

  closeButton: {
    marginTop: 22,
    height: 40,
    minWidth: 130,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },

  closeButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'SpedaBold',
  },
});