import { Image } from "expo-image";
import { type ReactNode } from "react";
import {
  StyleSheet,
  View,
  type ImageSourcePropType,
} from "react-native";

type Props = {
  children: ReactNode;
  imageSource?: ImageSourcePropType;
  contentPadding?: boolean;
};

export default function TableBackground({
  children,
  imageSource,
  contentPadding = true,
}: Props) {
  return (
    <View style={styles.background}>
      {imageSource ? (
        <Image
          source={imageSource}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.loadingBackground]} />
      )}

      <View
        style={[
          styles.overlay,
          !contentPadding && styles.overlayNoPadding,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
  },

  loadingBackground: {
    backgroundColor: "#090b1d",
  },

  overlay: {
    flex: 1,

    paddingHorizontal: 34,
    paddingTop: 60,
    paddingBottom: 20,

    justifyContent: "space-between",
  },

  overlayNoPadding: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
});