import { MatchReward } from '@/types/game';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

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
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>MATCH FINISHED</Text>

          <Text style={[styles.title, didWin ? styles.winText : styles.loseText]}>
            {didWin ? 'YOU WON!' : 'YOU LOST'}
          </Text>

          {reward && didWin && (
            <View style={styles.rewardBox}>
              <Text style={styles.rewardLabel}>REWARD</Text>
              <Text style={styles.rewardValue}>
                {reward.gold > 0
                  ? `+${reward.gold} Gold · +${reward.points} Point`
                  : `+${reward.points} Point`}
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={onPlayAgain}>
              <Text style={styles.secondaryButtonText}>Play Again</Text>
            </Pressable>

            <Pressable style={styles.primaryButton} onPress={onClose}>
              <Text style={styles.primaryButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 10,
  },

  title: {
    fontSize: 32,
    fontWeight: '900',
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
    fontWeight: '900',
    letterSpacing: 1,
    opacity: 0.75,
  },

  rewardValue: {
    marginTop: 5,
    color: '#facc15',
    fontSize: 16,
    fontWeight: '900',
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
    fontWeight: '900',
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
    fontWeight: '900',
  },
});