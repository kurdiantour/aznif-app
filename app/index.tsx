import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

export default function SplashScreen() {
  const router = useRouter();

  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
    ]).start();

    const timeout = setTimeout(() => {
      router.replace('/login');
    }, 1200);

    return () => clearTimeout(timeout);
  }, [opacity, scale, router]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.logoFallback,
          {
            opacity,
            transform: [{ scale }],
          },
        ]}
      >
        <Text style={styles.logoText}>DOMINO</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1530',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoFallback: {
    width: 180,
    height: 180,
    borderRadius: 42,
    backgroundColor: '#132347',
    borderWidth: 1,
    borderColor: '#24457f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 2,
  },
});