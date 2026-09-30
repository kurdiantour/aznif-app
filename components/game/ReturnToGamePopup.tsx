import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

export type ReturnToGamePopupProps = {
  loading: boolean;
  onReturn: () => void;
  onReject: () => void;
};

/** Game ownership, eligibility and navigation belong to the caller. */
export function ReturnToGamePopup({ loading, onReturn, onReject }: ReturnToGamePopupProps) {
  return (
    <View style={styles.overlay}>
      <LinearGradient
        colors={[
          "rgba(2, 6, 23, 0.92)",
          "rgba(9, 18, 40, 0.86)",
        ]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.fixedContent}>
        <View style={styles.card}>
          <View style={styles.headerPanel}>
            <Ionicons
              name="game-controller-outline"
              size={26}
              color="#f8d774"
            />

            <Text style={styles.title}>
              یارییەکەت هێشتا بەردەوامە
            </Text>

            <Text style={styles.subtitle}>
              دەتەوێت بگەڕێیتەوە بۆ یارییەکەت؟
            </Text>
          </View>

          <View style={styles.form}>
            <Pressable
              testID="return-to-game-return"
              style={styles.primaryButton}
              onPress={onReturn}
              disabled={loading}
            >
              <Text style={styles.primaryText}>
                {loading
                  ? "کەمێک چاوەڕێبە..."
                  : "گەڕانەوە بۆ یاری"}
              </Text>
            </Pressable>

            <Pressable
              testID="return-to-game-reject"
              style={styles.secondaryButton}
              onPress={onReject}
              disabled={loading}
            >
              <Text style={styles.secondaryText}>
                ڕەتکردنەوە
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 5000,
    elevation: 5000,
  },

  fixedContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },

  card: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(4, 10, 25, 0.86)",
    padding: 12,
  },

  headerPanel: {
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.22)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    paddingHorizontal: 14,
    paddingVertical: 16,
    marginBottom: 12,
  },

  title: {
    color: "#ffffff",
    fontSize: 19,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 10,
  },

  subtitle: {
    color: "#b6c2d8",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    lineHeight: 22,
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 8,
  },

  form: {
    gap: 9,
  },

  primaryButton: {
    minHeight: 48,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: "#2563eb",
    marginTop: 4,
  },

  primaryText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 15,
    textAlign: "center",
    writingDirection: "rtl",
  },

  secondaryButton: {
    minHeight: 46,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.34)",
    backgroundColor: "rgba(248, 215, 116, 0.1)",
  },

  secondaryText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 13,
    textAlign: "center",
    writingDirection: "rtl",
  },
});