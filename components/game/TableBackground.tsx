import { Image } from 'expo-image';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

type Props = {
  children: ReactNode;
};

export default function TableBackground({ children }: Props) {
  return (
    <View style={styles.background}>
      <Image
        source={require('@/assets/images/lobby/domino-table-bg.webp')}
        style={StyleSheet.absoluteFill}
        contentFit="fill"
        cachePolicy="memory-disk"
        transition={0}
      />
      <View style={styles.overlay}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
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
