import { StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";

import {
  ENABLE_GOLD_PURCHASES,
  ENABLE_SHOP_FEATURES,
} from "@/lib/platformFeatures";

export default function BuyGoldScreen() {
  if (!ENABLE_SHOP_FEATURES || !ENABLE_GOLD_PURCHASES) {
    return <Redirect href="/(tabs)/lobby" />;
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>فڕۆشتگای گەوهەر</Text>

      <Text style={styles.message}>
       ئەم بەشە لە وەشانی داهاتوودا چالاک دەکرێت.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#090b1d",
      paddingBottom: 90,

  },

  title: {
    color: "#ffffff",
    fontSize: 18,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  message: {
    marginTop: 10,
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    lineHeight: 21,
  },
});
