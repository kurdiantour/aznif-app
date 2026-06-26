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
      setMessage("Enter the email address for your account.");
      return;
    }

    setLoading(true);
    setStatus("idle");
    try {
      const { error } = await sendPasswordReset(cleanEmail);
      if (error) throw error;
      setStatus("success");
      setMessage(
        "If an account exists for this email, a password reset link has been sent.",
      );
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to send the reset email.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreen
      title="Reset your password"
      subtitle="We will email you a secure reset link."
    >
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
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
          <Text style={styles.primaryText}>Send reset email</Text>
        )}
      </Pressable>
      <Pressable onPress={() => router.replace("/login")} disabled={loading}>
        <Text style={styles.link}>Back to sign in</Text>
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
    borderWidth: 1,
    borderColor: "rgba(73, 112, 176, 0.55)",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontFamily: "RobotoMedium",
    textAlign: "center",
  },
  subtitle: {
    color: "#b7c8e8",
    fontSize: 14,
    fontFamily: "RobotoMedium",
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
    fontFamily: "RobotoMedium",
  },
  primaryButton: {
    height: 46,
    borderRadius: 8,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryText: { color: "#fff", fontFamily: "RobotoMedium", fontSize: 14 },
  disabled: { opacity: 0.6 },
  link: {
    color: "#9fc2ff",
    textAlign: "center",
    fontFamily: "RobotoMedium",
    marginTop: 20,
  },
  error: {
    color: "#fca5a5",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    textAlign: "center",
    marginBottom: 12,
  },
  success: {
    color: "#86efac",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 12,
  },
});
