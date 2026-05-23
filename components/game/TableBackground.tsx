import { ReactNode } from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';

type Props = {
  children: ReactNode;
};

export default function TableBackground({ children }: Props) {
  return (
    <ImageBackground
      source={require('@/assets/images/lobby/domino-table-bg.webp')}
      style={styles.background}
      imageStyle={styles.image}
      resizeMode="stretch"
    >
      <View style={styles.overlay}>{children}</View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    width: '100%',
    height: '100%',
  },

  image: {
    width: '100%',
    height: '100%',
  },

  overlay: {
    flex: 1,

    paddingHorizontal: 34,
    paddingTop: 60,
    paddingBottom: 20,

    justifyContent: 'space-between',
  },
});