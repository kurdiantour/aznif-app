import { StyleSheet, Text, View } from 'react-native';

export default function BuyGoldScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>Buy Gold</Text>
        <Text style={styles.message}>
          Gold purchases will be available here soon.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#090b1d',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.35)',
    backgroundColor: 'rgba(20,16,42,0.92)',
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },
  message: {
    marginTop: 10,
    color: '#c4b5fd',
    fontSize: 14,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
    lineHeight: 21,
  },
});
