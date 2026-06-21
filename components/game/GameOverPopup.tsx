import { MatchReward } from '@/types/game';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type GameOverPopupProps = {
  visible: boolean;
  didWin: boolean;
  reward?: MatchReward | null;
  onClose: () => void;
  onPlayAgain: () => void;
};

export default function GameOverPopup({
  visible,
  didWin,
  reward,
  onClose,
  onPlayAgain,
}: GameOverPopupProps) {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>یارییەکە تەواو بوو</Text>

          <Text style={[styles.title, didWin ? styles.winText : styles.loseText]}>
            {didWin ? 'تۆ بردتەوە!' : 'تۆ دۆڕایت'}
          </Text>

          {reward && didWin && (
            <View style={styles.rewardBox}>
              <Text style={styles.rewardLabel}>خەڵات</Text>
              <Text style={styles.rewardValue}>
                {reward.gold > 0
                  ? `+${reward.gold} Gold · +${reward.points} Point`
                  : `+${reward.points} Point`}
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={onPlayAgain}>
              <Text style={styles.secondaryButtonText}>دووبارە یاری بکە</Text>
            </Pressable>

            <Pressable style={styles.primaryButton} onPress={onClose}>
              <Text style={styles.primaryButtonText}>داخستن</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  card: {
    width: '100%',
    maxWidth: 350,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    backgroundColor: '#071f15',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.7)',
    alignItems: 'center',
  },

  eyebrow: {
    color: '#facc15',
    fontSize: 11,
    fontFamily: 'SpedaBold',
    letterSpacing: 1.4,
    marginBottom: 10,
  },

  title: {
    fontSize: 32,
    fontFamily: 'SpedaBold',
    letterSpacing: 0.8,
    marginBottom: 18,
  },

  winText: {
    color: '#facc15',
  },

  loseText: {
    color: '#f8f3df',
  },

  rewardBox: {
    width: '100%',
    borderRadius: 15,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(250, 204, 21, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.4)',
    alignItems: 'center',
  },

  rewardLabel: {
    color: '#f8f3df',
    fontSize: 10,
    fontFamily: 'SpedaBold',
    letterSpacing: 1,
    opacity: 0.75,
  },

  rewardValue: {
    marginTop: 5,
    color: '#facc15',
    fontSize: 16,
    fontFamily: 'SpedaBold',
  },

  actions: {
    marginTop: 22,
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },

  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248, 243, 223, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(248, 243, 223, 0.22)',
  },

  secondaryButtonText: {
    color: '#f8f3df',
    fontSize: 13,
    fontFamily: 'SpedaBold',
  },

  primaryButton: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#facc15',
  },

  primaryButtonText: {
    color: '#071f15',
    fontSize: 13,
    fontFamily: 'SpedaBold',
  },
});
