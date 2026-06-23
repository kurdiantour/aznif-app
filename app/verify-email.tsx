import { AuthScreen, styles } from "./forgot-password";
import { resendVerificationEmail } from "@/lib/supabaseAuth";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput } from "react-native";

export default function VerifyEmailScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const resend = async () => {
    if (!email.trim())
      return setMessage(
        "Enter your email address to resend the verification link.",
      );
    setLoading(true);
    setMessage("");
    try {
      const { error } = await resendVerificationEmail(email);
      if (error) throw error;
      setMessage(
        "Verification email sent. Check your inbox and open the link on this device.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to resend the verification email.",
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthScreen
      title="Verify your email"
      subtitle="Check your inbox and open the verification link to activate your account."
    >
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="Email (for resend)"
        placeholderTextColor="#7f8fb2"
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!loading}
      />
      {!!message && (
        <Text
          style={
            message.startsWith("Verification") ? styles.success : styles.error
          }
        >
          {message}
        </Text>
      )}
      <Pressable
        style={[styles.primaryButton, loading && styles.disabled]}
        onPress={resend}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>Resend verification email</Text>
        )}
      </Pressable>
      <Pressable onPress={() => router.replace("/login")} disabled={loading}>
        <Text style={styles.link}>Back to sign in</Text>
      </Pressable>
    </AuthScreen>
  );
}
