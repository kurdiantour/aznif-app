import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export default function SupportScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.page}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={18} color="#ffffff" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <Text style={styles.title}>Aznif Support</Text>
        <Text style={styles.paragraph}>
          Need help with your account, gameplay, leaderboard, wallet balance, or
          account deletion? Contact support and include your player ID when
          available.
        </Text>

        <View style={styles.section}>
          <Text style={styles.heading}>Contact</Text>
          <Text style={styles.paragraph}>Telegram: https://t.me/aznifcommunity</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Privacy</Text>
          <Text style={styles.paragraph}>
            Scores and game results are uploaded only for account-based features
            such as the global leaderboard. You can review the privacy policy in
            the app at /privacy.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#050b22",
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingVertical: 28,
  },
  page: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  backButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(15,23,42,0.68)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 22,
  },
  backText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "RobotoMedium",
  },
  title: {
    color: "#ffffff",
    fontSize: 28,
    fontFamily: "RobotoMedium",
    marginBottom: 14,
  },
  section: {
    marginTop: 24,
  },
  heading: {
    color: "#7dd3fc",
    fontSize: 17,
    fontFamily: "RobotoMedium",
    marginBottom: 8,
  },
  paragraph: {
    color: "#dbeafe",
    fontSize: 15,
    fontFamily: "RobotoMedium",
    lineHeight: 24,
  },
});
