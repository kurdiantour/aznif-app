import { Modal, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  winnerName?: string;
};

export default function WinnerPopup({ visible, winnerName }: Props) {
  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.label}>Round Winner</Text>

          <Text style={styles.winnerName}>
            {winnerName || 'Player'}
          </Text>

          <View style={styles.divider} />

          <Text style={styles.message}>
            Preparing next round...
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  card: {
    width: 360,
    minHeight: 190,
    borderRadius: 22,
    paddingHorizontal: 28,
    paddingVertical: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9, 37, 28, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.45)',
  },

  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#facc15',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  winnerName: {
    fontSize: 34,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
  },

  divider: {
    width: 120,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginVertical: 18,
  },

  message: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'center',
  },
});