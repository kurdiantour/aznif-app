import {
  Pressable,
  StyleSheet,
  Text,
} from "react-native";

type Props = {
  visible: boolean;
  loading?: boolean;
  onRetry: () => void;
};

export default function ConnectionErrorBanner({
  visible,
  loading = false,
  onRetry,
}: Props) {

  if (!visible) return null;

  return (
    <Pressable
      style={[
        styles.container,
        loading && styles.disabled,
      ]}
      disabled={loading}
      onPress={onRetry}
    >
      <Text style={styles.text}>
        پەیوەندی کێشەی هەیە — بۆ هەوڵدانەوە دابگرە
      </Text>
    </Pressable>
  );
}


const styles = StyleSheet.create({

  container: {
    position: "absolute",
    top: 68,
    left: 20,
    right: 20,
    zIndex: 1200,
    elevation: 1200,
    minHeight: 38,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(127,29,29,0.94)",
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.38)",
  },

  disabled: {
    opacity: 0.6,
  },

  text: {
    color: "#ffffff",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

});