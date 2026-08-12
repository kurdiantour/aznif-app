import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";

import { useLocalOkeyPreviewGame } from "@/okey/hooks/useLocalOkeyPreviewGame";
import OkeyGameTableScene from "@/okey/scenes/OkeyGameTableScene";

export default function OkeyPreviewScreen() {
  const controller = useLocalOkeyPreviewGame();

  if (!__DEV__) {
    return <Redirect href="/okey" />;
  }

  return (
    <View style={styles.container}>
      <OkeyGameTableScene
        controller={controller}
        preview
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});