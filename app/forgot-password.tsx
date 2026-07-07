import { sendPasswordReset } from "@/lib/supabaseAuth";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

function getPasswordResetErrorMessage(error: unknown) {
  const fallback = "نەتوانرا ئیمەیلی نوێکردنەوە بنێردرێت.";
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid") && normalized.includes("email")) {
    return "ئیمەیلەکە دروست نییە.";
  }

  if (normalized.includes("email")) {
    return fallback;
  }

  return message || fallback;
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setStatus("error");
      setMessage("ئیمەیلی هەژمارەکەت بنووسە.");
      return;
    }

    setLoading(true);
    setStatus("idle");
    try {
      const { error } = await sendPasswordReset(cleanEmail);
      if (error) throw error;
      setStatus("success");
      setMessage(
        "ئەگەر هەژمارێک بەم ئیمەیلە هەبێت، بەستەری نوێکردنەوەی وشەی نهێنی نێردرا.",
      );
    } catch (error) {
      setStatus("error");
      setMessage(getPasswordResetErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreen
      title="نوێکردنەوەی وشەی نهێنی"
      subtitle="بەستەرێکی پارێزراو بۆ ئیمەیلەکەت دەنێرین."
    >
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="ئیمەیل"
        placeholderTextColor="#7f8fb2"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        editable={!loading}
      />
      {status !== "idle" && (
        <Text style={status === "success" ? styles.success : styles.error}>
          {message}
        </Text>
      )}
      <Pressable
        style={[styles.primaryButton, loading && styles.disabled]}
        onPress={handleSend}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>ناردنی ئیمەیلی نوێکردنەوە</Text>
        )}
      </Pressable>
      <Pressable
        style={[styles.secondaryButton, loading && styles.disabled]}
        onPress={() => router.replace("/login")}
        disabled={loading}
      >
        <Text style={styles.secondaryText}>گەڕانەوە</Text>
      </Pressable>
    </AuthScreen>
  );
}

export function AuthScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {children}
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#050b22",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    padding: 24,
    borderRadius: 16,
    backgroundColor: "rgba(7, 26, 54, 0.9)",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
  subtitle: {
    color: "#b7c8e8",
    fontSize: 14,
    fontFamily: "SpedaBold",
    lineHeight: 21,
    textAlign: "center",
    marginTop: 10,
    marginBottom: 24,
  },
  input: {
    height: 46,
    borderRadius: 8,
    backgroundColor: "#081936",
    borderWidth: 1,
    borderColor: "rgba(73, 112, 176, 0.65)",
    color: "#fff",
    paddingHorizontal: 14,
    marginBottom: 12,
    fontFamily: "SpedaBold",
  },
  primaryButton: {
    height: 46,
    borderRadius: 8,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryText: { color: "#fff", fontFamily: "SpedaBold", fontSize: 14 },
  secondaryButton: {
    height: 46,
    borderRadius: 8,
    backgroundColor: "#4b5563",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  secondaryText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 14,
  },
  disabled: { opacity: 0.6 },
  link: {
    color: "#9fc2ff",
    textAlign: "center",
    fontFamily: "SpedaBold",
    marginTop: 20,
  },
  error: {
    color: "#fca5a5",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
    marginBottom: 12,
  },
  success: {
    color: "#86efac",
    fontSize: 13,
    fontFamily: "SpedaBold",
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 12,
  },
});
