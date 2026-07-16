import { AuthScreen, styles } from "./forgot-password";
import { updatePassword } from "@/lib/supabaseAuth";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const handleReset = async () => {
    if (password.length < 6)
      return setMessage("Your password must be at least 6 characters.");
    if (password !== confirmation) return setMessage("Passwords do not match.");
    setLoading(true);
    setMessage("");
    try {
      const { error } = await updatePassword(password);
      if (error) throw error;
      setSuccess(true);
      setMessage("Your password has been updated. You can now sign in.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update your password. Open a new reset link and try again.",
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthScreen
      title="Choose a new password"
      subtitle="Use a password with at least 6 characters."
    >
      <View style={styles.inputWrap}>
        <Ionicons name="lock-closed-outline" size={18} color="#9ca3af" />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="New password"
          placeholderTextColor="#8fa1bf"
          secureTextEntry
          autoComplete="new-password"
          editable={!loading && !success}
        />
      </View>
      <View style={styles.inputWrap}>
        <Ionicons name="shield-checkmark-outline" size={18} color="#9ca3af" />
        <TextInput
          style={styles.input}
          value={confirmation}
          onChangeText={setConfirmation}
          placeholder="Confirm new password"
          placeholderTextColor="#8fa1bf"
          secureTextEntry
          autoComplete="new-password"
          editable={!loading && !success}
        />
      </View>
      {!!message && (
        <Text style={success ? styles.success : styles.error}>{message}</Text>
      )}
      <Pressable
        style={[styles.primaryButton, (loading || success) && styles.disabled]}
        onPress={success ? () => router.replace("/login") : handleReset}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>
            {success ? "Go to sign in" : "Update password"}
          </Text>
        )}
      </Pressable>
    </AuthScreen>
  );
}
