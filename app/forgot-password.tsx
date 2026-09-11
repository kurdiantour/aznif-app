import { sendPasswordReset } from "@/lib/supabaseAuth";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

function getPasswordResetErrorMessage(error: unknown) {
  const fallback = "نەتوانرا ئیمەیڵی نوێکردنەوە بنێردرێت.";
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid") && normalized.includes("email")) {
    return "ئیمەیڵەکە دروست نییە.";
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
      setMessage("ئیمەیڵی هەژمارەکەت بنووسە.");
      return;
    }

    setLoading(true);
    setStatus("idle");
    try {
      const { error } = await sendPasswordReset(cleanEmail);
      if (error) throw error;
      setStatus("success");
      setMessage(
        "ئەگەر هەژمارێک بەم ئیمەیڵە هەبێت، بەستەری نوێکردنەوەی وشەی نهێنی نێردرا.",
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
      title="وشەی نهێنیت لەبیرکردووە؟"
      subtitle="ئیمەیڵەکەت بنووسە، بەستەری نوێکردنەوەت بۆ دەنێرین."
    >
      <View style={styles.inputWrap}>
        <Ionicons name="mail-outline" size={18} color="#9ca3af" />
        <TextInput
          style={[
  styles.input,
  email.length > 0 ? styles.ltrInput : styles.rtlInput,
]}
          value={email}
          onChangeText={setEmail}
          placeholder="ئیمەیڵ"
          placeholderTextColor="#8fa1bf"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          editable={!loading}
        />
      </View>

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
          <Text style={styles.primaryText}>ناردنی بەستەر</Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.secondaryButton, loading && styles.disabled]}
        onPress={() => router.back()}
        disabled={loading}
      >
        <Ionicons name="arrow-forward" size={18} color="#f8d774" />
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
  children: ReactNode;
}) {
  return (
    <ImageBackground
      source={require("@/assets/images/lobby/lobby-bg.webp")}
      resizeMode="cover"
      style={styles.background}
    >
      <LinearGradient
        colors={["rgba(2, 6, 23, 0.92)", "rgba(9, 18, 40, 0.86)"]}
        style={styles.overlay}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardView}
        >
          <View style={styles.fixedContent}>
            <View style={styles.card}>
              <View style={styles.headerPanel}>
                <Ionicons name="key-outline" size={26} color="#f8d774" />
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
              </View>
              <View style={styles.form}>{children}</View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </LinearGradient>
    </ImageBackground>
  );
}

export const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#020617",
  },
  overlay: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
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
  form: {
    gap: 9,
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
  inputWrap: {
    minHeight: 48,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.24)",
    backgroundColor: "rgba(15, 23, 42, 0.74)",
    paddingHorizontal: 13,
  },
  input: {
    flex: 1,
    minHeight: 46,
    color: "#ffffff",
    fontFamily: "SpedaRegular",
    fontSize: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  ltrInput: {
    fontFamily: "RobotoMedium",
    textAlign: "left",
    writingDirection: "ltr",
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
  disabled: { opacity: 0.65 },
  link: {
    color: "#9fc2ff",
    textAlign: "center",
    fontFamily: "SpedaBold",
    marginTop: 20,
  },

  rtlInput: {
  fontFamily: "SpedaRegular",
  textAlign: "right",
  writingDirection: "rtl",
},

  error: {
    color: "#fecaca",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    lineHeight: 20,
    textAlign: "center",
    writingDirection: "rtl",
  },
  success: {
    color: "#86efac",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    lineHeight: 20,
    textAlign: "center",
    writingDirection: "rtl",
  },
});

