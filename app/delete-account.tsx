import { AuthScreen, styles } from "./forgot-password";
import { supabase } from "@/lib/supabase";
import { signOut } from "@/lib/supabaseAuth";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

export default function DeleteAccountScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const removeAccount = async () => {
    setLoading(true);
    setMessage("");
    try {
      const { error } = await supabase.functions.invoke("delete_account");
      if (error) throw error;
      await signOut();
      router.replace("/login");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "نەتوانرا هەژمارەکەت بسڕدرێتەوە.",
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthScreen
      title="سڕینەوەی هەژمار"
      subtitle="ئەم کارە هەژمارەکەت و زانیارییەکانت بە تەواوی دەسڕێتەوە. ."
    >
      {!!message && <Text style={styles.error}>{message}</Text>}
      <Pressable
        style={[
          styles.primaryButton,
          { backgroundColor: "#b91c1c" },
          loading && styles.disabled,
        ]}
        onPress={removeAccount}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>سڕینەوەی هەژمار بە تەواوی</Text>
        )}
      </Pressable>
      <Pressable
        style={[deleteStyles.cancelButton, loading && styles.disabled]}
        onPress={() => router.back()}
        disabled={loading}
      >
        <Text style={deleteStyles.cancelButtonText}>هەڵوەشاندنەوە</Text>
      </Pressable>
    </AuthScreen>
  );
}

const deleteStyles = StyleSheet.create({
  cancelButton: {
    height: 46,
    borderRadius: 8,
    backgroundColor: "#4b5563",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  cancelButtonText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 14,
  },
});
