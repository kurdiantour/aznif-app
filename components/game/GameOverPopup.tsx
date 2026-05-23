import { MatchReward } from '@/types/game';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type GameOverPopupProps = {
  visible: boolean;
  didWin: boolean;
  reward?: MatchReward | null;
  onClose: () => void;
  onViewScore: () => void;
};

export default function GameOverPopup({
  visible,
  didWin,
  reward,
  onClose,
  onViewScore,
}: GameOverPopupProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>MATCH FINISHED</Text>

          <Text style={[styles.title, didWin ? styles.winText : styles.loseText]}>
            {didWin ? 'YOU WON!' : 'YOU LOST'}
          </Text>

          <Text style={styles.message}>
            {didWin
              ? 'Great game! You finished this match as the winner.'
              : 'Good try! The opponent won this match.'}
          </Text>

          {reward && didWin && (
            <View style={styles.rewardBox}>
              <Text style={styles.rewardLabel}>Reward</Text>
              <Text style={styles.rewardValue}>
                +{reward.gold} Gold · +{reward.points} Points
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={onViewScore}>
              <Text style={styles.secondaryButtonText}>View Score</Text>
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
    maxWidth: 360,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 24,
    backgroundColor: '#082016',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.65)',
    alignItems: 'center',
  },

  eyebrow: {
    color: '#facc15',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 8,
  },

  title: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  winText: {
    color: '#facc15',
  },

  loseText: {
    color: '#f8f3df',
  },

  message: {
    color: '#f8f3df',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    opacity: 0.9,
  },

  rewardBox: {
    marginTop: 18,
    width: '100%',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(250, 204, 21, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.35)',
    alignItems: 'center',
  },

  rewardLabel: {
    color: '#f8f3df',
    fontSize: 11,
    fontWeight: '800',
    opacity: 0.8,
  },

  rewardValue: {
    marginTop: 4,
    color: '#facc15',
    fontSize: 15,
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
    height: 46,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248, 243, 223, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(248, 243, 223, 0.2)',
  },

  secondaryButtonText: {
    color: '#f8f3df',
    fontSize: 13,
    fontWeight: '900',
  },

  primaryButton: {
    flex: 1,
    height: 46,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#facc15',
  },

  primaryButtonText: {
    color: '#082016',
    fontSize: 13,
    fontWeight: '900',
  },
});