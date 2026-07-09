import { useProfile } from "@/lib/profile";
import {
  getCurrentUser,
  getOrCreateProfile,
  signInWithEmail,
  signUpWithEmail,
  updateMyProfile,
} from "@/lib/supabaseAuth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const SAVED_EMAIL_KEY = "domino_saved_email";

export default function LoginScreen() {
  const router = useRouter();
  const { refreshProfile } = useProfile();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [isLoading, setIsLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function verifySession() {
      try {
        const savedEmail = await AsyncStorage.getItem(SAVED_EMAIL_KEY);

        if (savedEmail && isMounted) {
          setEmail(savedEmail);
        }

        const user = await getCurrentUser();

        if (user && isMounted) {
          await getOrCreateProfile();
          router.replace("/(tabs)/lobby");
          return;
        }
      } catch {
        // Ignore session errors and show auth form.
      } finally {
        if (isMounted) {
          setCheckingSession(false);
        }
      }
    }

    verifySession();

    return () => {
      isMounted = false;
    };
  }, [router]);

  const handleAuth = async (authMode = mode) => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();

    if (!cleanEmail || !password) {
      setMessage("تکایە ئیمەیڵ و وشەی نهێنی بنووسە.");
      return;
    }

    if (authMode === "signup" && cleanUsername.length < 3) {
      setMessage("ناوی بەکارهێنەر دەبێت لانیکەم ٣ پیت بێت.");
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const result =
        authMode === "signup"
          ? await signUpWithEmail(cleanEmail, password)
          : await signInWithEmail(cleanEmail, password);

      if (result.error) {
        setMessage(
          authMode === "signup"
            ? "نەتوانرا هەژمارەکە دروست بکرێت. تکایە زانیارییەکان بپشکنە و دووبارە هەوڵ بدەوە."
            : "ئیمەیڵ یان وشەی نهێنی هەڵەیە.",
        );
        return;
      }

      const profile = await getOrCreateProfile();

      if (!profile) {
        setMessage(
          "نەتوانرا بچیتە ژوورەوە. تکایە ئیمەیڵەکەت پشتڕاست بکەرەوە و دووبارە هەوڵ بدەوە.",
        );
        return;
      }

      if (authMode === "signup") {
        await updateMyProfile({ username: cleanUsername });
        await refreshProfile();
      }

      await AsyncStorage.setItem(SAVED_EMAIL_KEY, cleanEmail);
      router.replace("/(tabs)/lobby");
    } catch (error) {
      console.warn("[auth] login failed", error);

      setMessage("هەڵەیەک ڕوویدا. تکایە دووبارە هەوڵ بدەوە.");
    } finally {
      setIsLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#7dd3fc" size="large" />
      </View>
    );
  }

  const isSignup = mode === "signup";

  const chooseAuthMode = (nextMode: "signin" | "signup") => {
    if (mode !== nextMode) {
      setMode(nextMode);
      setMessage(null);
      return;
    }

    void handleAuth(nextMode);
  };

  return (
    <View style={styles.container}>
      <View style={styles.formCard}>
        {isSignup ? (
        <TextInput
          placeholder="ناوی بەکارهێنەر"
          placeholderTextColor="#7f8fb2"
          style={styles.input}
            autoCapitalize="none"
            value={username}
            onChangeText={setUsername}
            editable={!isLoading}
          />
        ) : null}

        <TextInput
          placeholder="ئیمەیڵ"
          placeholderTextColor="#7f8fb2"
          style={[
            styles.input,
            email.trim() ? styles.latinInput : null,
            email.trim() ? styles.ltrInput : null,
          ]}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!isLoading}
        />

        <TextInput
          placeholder="وشەی نهێنی"
          placeholderTextColor="#7f8fb2"
          style={styles.input}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!isLoading}
        />

        {message ? <Text style={styles.messageText}>{message}</Text> : null}

        <View style={styles.authButtons}>
          <Pressable
            style={[styles.primaryButton, isSignup && styles.secondaryButton, isLoading && styles.disabledButton]}
            onPress={() => chooseAuthMode("signin")}
            disabled={isLoading}
          >
            {isLoading && !isSignup ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text
                style={styles.primaryButtonText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
              >
                چوونەژوورەوە
              </Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.primaryButton, !isSignup && styles.secondaryButton, isLoading && styles.disabledButton]}
            onPress={() => chooseAuthMode("signup")}
            disabled={isLoading}
          >
            {isLoading && isSignup ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text
                style={styles.primaryButtonText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
              >
                دروستکردنی هەژمار
              </Text>
            )}
          </Pressable>
        </View>

        {isSignup ? (
          <View style={styles.privacyRow}>
            <Text style={styles.privacyText}>
              بە دروستکردنی هەژمار، ڕازی دەبیت بە
            </Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
              hitSlop={8}
              onPress={() => router.push("/privacy")}
            >
              <Text style={styles.privacyLink}>سیاسەتی پاراستنی نهێنی</Text>
            </Pressable>
          </View>
        ) : null}

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050b22",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },

  formCard: {
    width: "100%",
    maxWidth: 330,
    paddingHorizontal: 8,
  },

input: {
  height: 40,
  borderRadius: 6,
  backgroundColor: "rgba(7, 26, 54, 0.78)",
  color: "#ffffff",
  fontFamily: "SpedaRegular",
  textAlign: "right",
  writingDirection: "rtl",
  paddingHorizontal: 14,
  marginBottom: 12,
  borderWidth: 1,
  borderColor: "rgba(33, 65, 111, 0.65)",
  fontSize: 13,
},

  messageText: {
    color: "#fca5a5",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    marginBottom: 10,
    textAlign: "center",
  },

  primaryButton: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },

  authButtons: {
    flexDirection: "row",
    gap: 10,
  },

  secondaryButton: {
    backgroundColor: "#334155",
  },

  disabledButton: {
    opacity: 0.65,
  },

  primaryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
    includeFontPadding: false,
  },

  privacyRow: {
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },

  privacyText: {
    color: "#a8b7d5",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    textAlign: "center",
    writingDirection: "rtl",
  },

  kurdishInput: {
  fontFamily: "SpedaBold",
},

latinInput: {
  fontFamily: "RobotoMedium",
},

ltrInput: {
  textAlign: "left",
  writingDirection: "ltr",
},

  privacyLink: {
    color: "#7dd3fc",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
    textDecorationLine: "underline",
  },

});
