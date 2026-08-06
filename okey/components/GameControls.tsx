import {
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  onOpenMenu: () => void;
  onOpenChat: () => void;
};

export default function GameControls({
  onOpenMenu,
  onOpenChat,
}: Props) {
  return (
    <View style={styles.container}>

      <Pressable
        style={styles.button}
        onPress={onOpenMenu}
      >
        <Ionicons
          name="menu-outline"
          size={22}
          color="#f8f3df"
        />
      </Pressable>


      <Pressable
        style={styles.button}
        onPress={onOpenChat}
      >
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={22}
          color="#f8f3df"
        />
      </Pressable>

    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 18,
    right: 18,
    zIndex: 900,
    elevation: 900,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  button: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248,243,223,0.22)",
  },
});