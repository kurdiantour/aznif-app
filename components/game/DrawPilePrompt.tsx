import { Pressable, StyleSheet, Text, View } from 'react-native';

type DrawPilePromptProps = {
  visible: boolean;
  boneyardCount: number;
  onDraw: () => void;
  onPass?: () => void;
  passCountdown?: number;
  passing?: boolean;
};

export default function DrawPilePrompt({
  visible,
  boneyardCount,
  onDraw,
  onPass,
  passCountdown,
  passing = false,
}: DrawPilePromptProps) {
  if (!visible) return null;

  const hasTiles = boneyardCount > 0;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <Text style={styles.title}>No playable tile</Text>

        <Text style={styles.subtitle}>
          {hasTiles
            ? 'Draw a hidden domino from the pile to continue.'
            : 'You have no legal move. Pass the turn to continue.'}
        </Text>

        {hasTiles ? (
          <Pressable style={styles.drawButton} onPress={onDraw}>
            <Text style={styles.drawButtonText}>Draw Tile</Text>
          </Pressable>
        ) : (
          <Text style={styles.emptyText}>The pile is empty.</Text>
        )}

        <Text style={styles.countText}>{boneyardCount} tiles left</Text>

        {!hasTiles && onPass && (
          <Pressable
            style={[styles.passButton, passing && styles.buttonDisabled]}
            onPress={onPass}
            disabled={passing}
          >
            <Text style={styles.passButtonText}>
              {passing ? 'Passing...' : 'Pass Turn'}
            </Text>
          </Pressable>
        )}

        {!hasTiles && typeof passCountdown === 'number' && (
          <Text style={styles.passCountdown}>
            Auto-pass in {passCountdown}s
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 76,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 120,
  },

  card: {
    width: 292,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(3, 17, 11, 0.97)',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.4)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },

  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },

  subtitle: {
    marginTop: 5,
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    textAlign: 'center',
  },

  drawButton: {
    width: 184,
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8b5cf6',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },

  drawButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  countText: {
    marginTop: 10,
    color: '#facc15',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },

  emptyText: {
    marginTop: 14,
    color: 'rgba(255, 255, 255, 0.78)',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },

  passButton: {
    marginTop: 12,
    minWidth: 132,
    height: 40,
    paddingHorizontal: 18,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },

  passButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  buttonDisabled: {
    opacity: 0.6,
  },

  passCountdown: {
    marginTop: 9,
    color: '#facc15',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
});
